import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadLinkPreviewSettings, saveLinkPreviewSettings } from './link-preview-settings'
describe('link preview consent', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('defaults both general previews and encrypted-room disclosure to off', () => {
    expect(loadLinkPreviewSettings()).toEqual({ enabled: false, encrypted: false })
  })
  it('requires separate explicit boolean consent for encrypted rooms', () => {
    saveLinkPreviewSettings({ enabled: true })
    expect(loadLinkPreviewSettings()).toEqual({ enabled: true, encrypted: false })
    saveLinkPreviewSettings({ encrypted: true })
    expect(loadLinkPreviewSettings()).toEqual({ enabled: true, encrypted: true })
    localStorage.setItem('nexspeak_link_preview_settings', '{"enabled":"true","encrypted":1}')
    expect(loadLinkPreviewSettings()).toEqual({ enabled: false, encrypted: false })
  })
  it('fails closed if preferences are malformed', () => {
    localStorage.setItem('nexspeak_link_preview_settings', '{broken')
    expect(loadLinkPreviewSettings()).toEqual({ enabled: false, encrypted: false })
  })
})
