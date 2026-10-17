/**
 * Encryption security: recovery key (secret storage), server-side key backup and
 * verification of this device. Follows the same model as Element, so a recovery key
 * created here works there and vice versa.
 */

import type { MatrixClient } from 'matrix-js-sdk'
import { decodeRecoveryKey, type CryptoApi } from 'matrix-js-sdk/lib/crypto-api/index.js'
import { forgetSecretStorageKey, withSecretStorageKey } from './secret-storage'
import { t } from '@nexspeak/i18n'

export interface SecurityStatus {
  /** The account has cross-signing keys (set up here or in another client). */
  accountHasCrossSigning: boolean
  /** A recovery key / secret storage exists on the account. */
  hasRecovery: boolean
  /** This device is verified (cross-signed by the user's own identity). */
  isDeviceVerified: boolean
  /** Version of the active server-side key backup this device uploads to, if any. */
  backupVersion: string | null
}

function requireCrypto(client: MatrixClient): CryptoApi {
  const crypto = client.getCrypto()
  if (!crypto) throw new Error(t('security.cryptoUnavailable'))
  return crypto
}

export async function getSecurityStatus(client: MatrixClient): Promise<SecurityStatus> {
  const crypto = requireCrypto(client)
  const userId = client.getUserId() ?? ''
  const deviceId = client.getDeviceId() ?? ''

  const [accountHasCrossSigning, defaultKeyId, deviceStatus, backupVersion] = await Promise.all([
    crypto.userHasCrossSigningKeys(userId, true),
    client.secretStorage.getDefaultKeyId(),
    crypto.getDeviceVerificationStatus(userId, deviceId),
    crypto.getActiveSessionBackupVersion(),
  ])

  return {
    accountHasCrossSigning,
    hasRecovery: Boolean(defaultKeyId),
    isDeviceVerified: Boolean(deviceStatus?.crossSigningVerified),
    backupVersion,
  }
}

/**
 * First-time setup: create cross-signing keys, a recovery key and a key backup.
 * Returns the recovery key, which the user has to store safely.
 */
export async function setupRecovery(client: MatrixClient, password: string): Promise<string> {
  const crypto = requireCrypto(client)
  const userId = client.getUserId() ?? ''
  let recoveryKey: string | undefined

  try {
    await crypto.bootstrapCrossSigning({
      authUploadDeviceSigningKeys: async (makeRequest) => {
        await makeRequest({
          type: 'm.login.password',
          identifier: { type: 'm.id.user', user: userId },
          password,
        })
      },
    })

    await crypto.bootstrapSecretStorage({
      createSecretStorageKey: async () => {
        const generated = await crypto.createRecoveryKeyFromPassphrase()
        recoveryKey = generated.encodedPrivateKey
        return generated
      },
      setupNewSecretStorage: true,
      setupNewKeyBackup: true,
    })
  } finally {
    forgetSecretStorageKey()
  }

  if (!recoveryKey) throw new Error(t('security.error.createFailed'))
  return recoveryKey
}

/**
 * Verify this device with the recovery key and restore old message keys from the backup.
 * Returns how many room keys were restored.
 */
export async function verifyWithRecoveryKey(client: MatrixClient, input: string): Promise<number> {
  const crypto = requireCrypto(client)

  let key: Uint8Array<ArrayBuffer>
  try {
    key = decodeRecoveryKey(input.trim())
  } catch {
    throw new Error(t('security.error.invalidKey'))
  }

  const keyId = await client.secretStorage.getDefaultKeyId()
  const keyInfo = keyId ? (await client.secretStorage.getKey(keyId))?.[1] : undefined
  if (!keyId || !keyInfo) throw new Error(t('security.error.noRecovery'))
  if (!(await client.secretStorage.checkKey(key, keyInfo))) {
    throw new Error(t('security.error.wrongKey'))
  }

  await withSecretStorageKey(key, keyId, async () => {
    // Imports the cross-signing keys from secret storage and signs this device with them.
    await crypto.bootstrapCrossSigning({})
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage()
  })

  await crypto.checkKeyBackupAndEnable()
  const result = await crypto.restoreKeyBackup()
  return result.imported
}
