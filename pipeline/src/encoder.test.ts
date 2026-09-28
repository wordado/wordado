import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { ffmpegEncoder, hasFfmpeg } from './encoder'

// CI installs ffmpeg for this suite (Task 18); a laptop without it skips only this file.
describe.skipIf(!hasFfmpeg())('ffmpegEncoder', () => {
  const tone = (): Uint8Array =>
    new Uint8Array(
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-af', 'adelay=400,apad=pad_dur=0.4', '-c:a', 'libmp3lame', '-f', 'mp3', 'pipe:1']),
    )

  it('trims the silence around the sound and writes AAC in MP4', async () => {
    const out = await ffmpegEncoder().toM4a(tone())
    expect(new TextDecoder().decode(out.bytes.slice(4, 8))).toBe('ftyp')
    expect(out.seconds).toBeGreaterThan(0.4)
    expect(out.seconds).toBeLessThan(0.9)
  })

  it('gives the same bytes for the same input', async () => {
    const input = tone()
    const [a, b] = [await ffmpegEncoder().toM4a(input), await ffmpegEncoder().toM4a(input)]
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true)
  })

  it('encodes 16-bit PCM wrapped as WAV, as the TTS hands over for Gemini voices', async () => {
    const wav = new Uint8Array(
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-af', 'adelay=400,apad=pad_dur=0.4', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1']),
    )
    const out = await ffmpegEncoder().toM4a(wav)
    expect(new TextDecoder().decode(out.bytes.slice(4, 8))).toBe('ftyp')
    expect(out.seconds).toBeGreaterThan(0.4)
    expect(out.seconds).toBeLessThan(0.9)
  })

  it('names the problem when the input is not audio', async () => {
    await expect(ffmpegEncoder().toM4a(new TextEncoder().encode('not audio'))).rejects.toThrow(/ffmpeg/)
  })
})
