import { describe, expect, it } from "vitest"
import { decryptAttachment, encryptAttachment, isEncryptedFile } from "./attachments"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe("encrypted attachments", () => {
  it("round-trips data through encrypt and decrypt", async () => {
    const plaintext = encoder.encode("Hallo NexSpeak – mit Umlauten äöü 🎉")
    const { ciphertext, info } = await encryptAttachment(plaintext.buffer as ArrayBuffer)

    expect(new Uint8Array(ciphertext)).not.toEqual(plaintext)
    expect(decoder.decode(await decryptAttachment(ciphertext, info))).toBe("Hallo NexSpeak – mit Umlauten äöü 🎉")
  })

  it("produces spec-compliant metadata", async () => {
    const { info } = await encryptAttachment(new Uint8Array(32).buffer)

    expect(info.v).toBe("v2")
    expect(info.key).toMatchObject({ alg: "A256CTR", kty: "oct", ext: true })
    expect(info.key.k).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // Unpadded base64; the last 8 bytes of the IV (the counter) must be zero.
    expect(info.iv).not.toContain("=")
    const iv = Uint8Array.from(atob(info.iv + "=="), (char) => char.charCodeAt(0))
    expect(Array.from(iv.subarray(8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it("rejects tampered ciphertext", async () => {
    const { ciphertext, info } = await encryptAttachment(encoder.encode("secret").buffer as ArrayBuffer)
    const tampered = new Uint8Array(ciphertext.slice(0))
    tampered[0] ^= 0xff

    await expect(decryptAttachment(tampered.buffer, info)).rejects.toThrow(/verändert|beschädigt/)
  })

  // Official vectors from https://github.com/matrix-org/matrix-encrypt-attachment (test/decrypt.Spec.js).
  const key = { alg: "A256CTR" as const, ext: true as const, k: "__________________________________________8", key_ops: ["encrypt", "decrypt"], kty: "oct" as const }
  const vectors = [
    {
      name: "v2: Hello, World",
      ciphertext: "5xJZTt5cQicm+9f4",
      file: { v: "v2", iv: "//////////8AAAAAAAAAAA", key, hashes: { sha256: "YzF08lARDdOCzJpzuSwsjTNlQc4pHxpdHcXiD/wpK6k" } },
      plaintext: "Hello, World",
    },
    {
      name: "v2: long text",
      ciphertext: "zhtFStAeFx0s+9L/sSQO+WQMtldqYEHqTxMduJrCIpnkyer09kxJJuA4K+adQE4w+7jZe/vR9kIcqj9rOhDR8Q",
      file: { v: "v2", iv: "//////////8AAAAAAAAAAA", key, hashes: { sha256: "IOq7/dHHB+mfHfxlRY5XMeCWEwTPmlf4cJcgrkf6fVU" } },
      plaintext: "alphanumericallyalphanumericallyalphanumericallyalphanumerically",
    },
    {
      name: "v1",
      ciphertext: "tJVNBVJ/vl36UQt4Y5e5m84bRUrQHhcdLPvS/7EkDvlkDLZXamBB6k8THbiawiKZ5Mnq9PZMSSbgOCvmnUBOMA",
      file: { v: "v1", iv: "/////////////////////w", key, hashes: { sha256: "LYG/orOViuFwovJpv2YMLSsmVKwLt7pY3f8SYM7KU5E" } },
      plaintext: "alphanumericallyalphanumericallyalphanumericallyalphanumerically",
    },
  ]

  it.each(vectors)("decrypts the reference vector ($name)", async ({ ciphertext, file, plaintext }) => {
    const bytes = Uint8Array.from(atob(ciphertext.padEnd(Math.ceil(ciphertext.length / 4) * 4, "=")), (char) => char.charCodeAt(0))
    expect(decoder.decode(await decryptAttachment(bytes.buffer, file))).toBe(plaintext)
  })

  it("recognises encrypted file objects", () => {
    expect(isEncryptedFile({ url: "mxc://a/b", iv: "x", key: { k: "y" }, hashes: { sha256: "z" } })).toBe(true)
    expect(isEncryptedFile({ url: "mxc://a/b" })).toBe(false)
    expect(isEncryptedFile(null)).toBe(false)
  })
})
