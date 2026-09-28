import { execFile, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface Encoded {
  readonly bytes: Uint8Array
  readonly seconds: number
}

export interface Encoder {
  /** Any audio ffmpeg recognises by its content: the TTS hands over MP3, or WAV for a PCM voice. */
  toM4a(audio: Uint8Array): Promise<Encoded>
}

/**
 * Silence trimmed from both ends (the reverse trick trims the tail), EBU R128
 * loudness at −16 LUFS so every word plays at one volume, 0.1 s of tail, and
 * mono AAC at 48 kbit/s in MP4: the sample's format, `audio/mp4` (Decision 11).
 * Bit-exact flags and no metadata make the same input give the same bytes.
 */
const FILTER = [
  'silenceremove=start_periods=1:start_threshold=-50dB',
  'areverse',
  'silenceremove=start_periods=1:start_threshold=-50dB',
  'areverse',
  'loudnorm=I=-16:TP=-1.5:LRA=11',
  'apad=pad_dur=0.1',
].join(',')

export function ffmpegEncoder(opts: { ffmpeg?: string; ffprobe?: string } = {}): Encoder {
  const ffmpeg = opts.ffmpeg ?? 'ffmpeg'
  const ffprobe = opts.ffprobe ?? 'ffprobe'
  return {
    async toM4a(audio) {
      const dir = mkdtempSync(join(tmpdir(), 'clip-'))
      // No extension: ffmpeg recognises MP3 and WAV by their content.
      const input = join(dir, 'in.audio')
      const output = join(dir, 'out.m4a')
      try {
        writeFileSync(input, audio)
        try {
          await run(ffmpeg, [
            '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
            '-af', FILTER, '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '48k',
            '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-movflags', '+faststart',
            output,
          ])
        } catch (err) {
          throw new Error(`ffmpeg could not encode the clip: ${(err as { stderr?: string }).stderr?.trim() || String(err)}`)
        }
        const probe = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', output])
        return { bytes: new Uint8Array(readFileSync(output)), seconds: Number(probe.stdout.trim()) }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  }
}

export function hasFfmpeg(): boolean {
  try {
    return spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0
  } catch {
    return false
  }
}
