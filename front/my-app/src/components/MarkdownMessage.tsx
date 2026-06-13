import type { ReactNode } from 'react'

type MarkdownMessageProps = {
  content: string
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g)
  const nodes: ReactNode[] = []

  parts.forEach((part, partIndex) => {
    const partKey = `${keyPrefix}-part-${partIndex}`

    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      nodes.push(<code key={partKey}>{part.slice(1, -1)}</code>)
      return
    }

    part.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g).forEach((token, tokenIndex) => {
      const tokenKey = `${partKey}-token-${tokenIndex}`

      if (!token) {
        return
      }

      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        nodes.push(
          <a
            href={linkMatch[2]}
            key={tokenKey}
            rel="noreferrer"
            target="_blank"
          >
            {linkMatch[1]}
          </a>,
        )
        return
      }

      const boldMatch = token.match(/^\*\*([^*]+)\*\*$/)
      if (boldMatch) {
        nodes.push(<strong key={tokenKey}>{boldMatch[1]}</strong>)
        return
      }

      nodes.push(token)
    })
  })

  return nodes
}

export default function MarkdownMessage({ content }: MarkdownMessageProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: Array<
    | { type: 'heading'; level: number; text: string }
    | { type: 'paragraph'; text: string }
    | { type: 'ul'; items: string[] }
    | { type: 'ol'; items: string[] }
    | { type: 'code'; text: string }
  > = []

  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      index += 1
      const codeLines: string[] = []

      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }

      if (index < lines.length) {
        index += 1
      }

      blocks.push({ type: 'code', text: codeLines.join('\n') })
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2],
      })
      index += 1
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []

      while (index < lines.length) {
        const listLine = lines[index].trim()
        if (!/^[-*]\s+/.test(listLine)) {
          break
        }
        items.push(listLine.replace(/^[-*]\s+/, ''))
        index += 1
      }

      blocks.push({ type: 'ul', items })
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []

      while (index < lines.length) {
        const listLine = lines[index].trim()
        if (!/^\d+\.\s+/.test(listLine)) {
          break
        }
        items.push(listLine.replace(/^\d+\.\s+/, ''))
        index += 1
      }

      blocks.push({ type: 'ol', items })
      continue
    }

    const paragraphLines = [trimmed]
    index += 1

    while (index < lines.length) {
      const nextLine = lines[index].trim()
      if (
        !nextLine ||
        nextLine.startsWith('```') ||
        /^#{1,6}\s+/.test(nextLine) ||
        /^[-*]\s+/.test(nextLine) ||
        /^\d+\.\s+/.test(nextLine)
      ) {
        break
      }

      paragraphLines.push(nextLine)
      index += 1
    }

    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') })
  }

  return (
    <div className="markdown-message">
      {blocks.map((block, blockIndex) => {
        const key = `block-${blockIndex}`

        if (block.type === 'heading') {
          switch (block.level) {
            case 1:
              return <h1 key={key}>{renderInline(block.text, key)}</h1>
            case 2:
              return <h2 key={key}>{renderInline(block.text, key)}</h2>
            case 3:
              return <h3 key={key}>{renderInline(block.text, key)}</h3>
            case 4:
              return <h4 key={key}>{renderInline(block.text, key)}</h4>
            case 5:
              return <h5 key={key}>{renderInline(block.text, key)}</h5>
            default:
              return <h6 key={key}>{renderInline(block.text, key)}</h6>
          }
        }

        if (block.type === 'ul') {
          return (
            <ul key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-item-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </ul>
          )
        }

        if (block.type === 'ol') {
          return (
            <ol key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-item-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </ol>
          )
        }

        if (block.type === 'code') {
          return (
            <pre key={key}>
              <code>{block.text}</code>
            </pre>
          )
        }

        return <p key={key}>{renderInline(block.text, key)}</p>
      })}
    </div>
  )
}
