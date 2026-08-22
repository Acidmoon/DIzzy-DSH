import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'

afterEach(cleanup)

describe('GenUI native media', () => {
  it('renders user-controlled audio without autoplay', () => {
    const spec = repairGenuiSpec({
      items: [{
        type: 'audio',
        src: '/mmx-files/sample.mp3',
        alt: '语音结果',
        loop: true,
        autoplay: true,
        controls: false,
      }],
    })!
    const { container } = render(<GenuiBlock spec={spec} />)
    const audio = container.querySelector('audio')

    expect(audio).not.toBeNull()
    expect(audio?.getAttribute('src')).toBe('/mmx-files/sample.mp3')
    expect(audio?.getAttribute('aria-label')).toBe('语音结果')
    expect(audio?.controls).toBe(true)
    expect(audio?.autoplay).toBe(false)
    expect(audio?.preload).toBe('metadata')
    expect(audio?.loop).toBe(true)
  })

  it('renders user-controlled video with poster and aspect ratio', () => {
    const spec = repairGenuiSpec({
      items: [{
        type: 'video',
        src: 'https://cdn.example.com/result.mp4',
        alt: 'AI 生成视频',
        poster: '/mmx-files/result.jpg',
        aspectRatio: '16:9',
        muted: true,
        loop: true,
        autoplay: true,
        controls: false,
      }],
    })!
    const { container } = render(<GenuiBlock spec={spec} />)
    const video = container.querySelector('video')

    expect(video).not.toBeNull()
    expect(video?.getAttribute('src')).toBe('https://cdn.example.com/result.mp4')
    expect(video?.getAttribute('poster')).toBe('/mmx-files/result.jpg')
    expect(video?.getAttribute('aria-label')).toBe('AI 生成视频')
    expect(video?.controls).toBe(true)
    expect(video?.autoplay).toBe(false)
    expect(video?.preload).toBe('metadata')
    expect(video?.muted).toBe(true)
    expect(video?.loop).toBe(true)
    expect(video?.playsInline).toBe(true)
    expect(video?.style.aspectRatio).toBe('16 / 9')
  })

  it('shows an honest fallback when media cannot be played', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'audio', src: '/mmx-files/missing.mp3', alt: '试听' },
        { type: 'video', src: '/mmx-files/missing.mp4', alt: '预览' },
      ],
    })!
    const { container, getByText } = render(<GenuiBlock spec={spec} />)

    fireEvent.error(container.querySelector('audio')!)
    fireEvent.error(container.querySelector('video')!)
    expect(getByText('音频无法播放')).not.toBeNull()
    expect(getByText('视频无法播放')).not.toBeNull()
  })
})
