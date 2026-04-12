import { describe, it, expect } from "vitest"
import { sanitizeUserInput } from "@/lib/sanitize"

describe("sanitizeUserInput", () => {
  it("passes through plain text unchanged", () => {
    expect(sanitizeUserInput("Hello world")).toBe("Hello world")
  })

  it("strips script tags", () => {
    const input = '<script>alert("xss")</script>hello'
    const result = sanitizeUserInput(input)
    expect(result).not.toContain("<script>")
    expect(result).toContain("hello")
  })

  it("strips event handler attributes", () => {
    const input = '<img src=x onerror="alert(1)">'
    const result = sanitizeUserInput(input)
    expect(result).not.toContain("onerror")
  })

  it("allows safe HTML tags", () => {
    const input = "<b>bold</b> and <i>italic</i>"
    const result = sanitizeUserInput(input)
    expect(result).toContain("<b>")
    expect(result).toContain("<i>")
  })

  it("strips javascript: protocol in links", () => {
    const input = '<a href="javascript:alert(1)">click</a>'
    const result = sanitizeUserInput(input)
    expect(result).not.toContain("javascript:")
  })

  it("handles empty string", () => {
    expect(sanitizeUserInput("")).toBe("")
  })

  it("handles string with only tags", () => {
    const result = sanitizeUserInput("<script></script>")
    expect(result).toBe("")
  })

  // SVG-based XSS
  describe("SVG-based XSS", () => {
    it("strips script tags inside SVG", () => {
      const result = sanitizeUserInput("<svg><script>alert(1)</script></svg>")
      expect(result).not.toContain("<script>")
      expect(result).not.toContain("alert(1)")
    })

    it("strips onload handler on SVG element", () => {
      const result = sanitizeUserInput('<svg onload="alert(1)">')
      expect(result).not.toContain("onload")
      expect(result).not.toContain("alert(1)")
    })

    it("strips SVG animate with event handlers", () => {
      const result = sanitizeUserInput(
        '<svg><animate onbegin="alert(1)" attributeName="x" dur="1s">'
      )
      expect(result).not.toContain("onbegin")
      expect(result).not.toContain("alert(1)")
    })
  })

  // iframe injection
  describe("iframe injection", () => {
    it("strips iframe tags", () => {
      const result = sanitizeUserInput(
        '<iframe src="https://evil.com"></iframe>'
      )
      expect(result).not.toContain("<iframe")
      expect(result).not.toContain("evil.com")
    })

    it("strips iframe with srcdoc", () => {
      const result = sanitizeUserInput(
        '<iframe srcdoc="<script>alert(1)</script>"></iframe>'
      )
      expect(result).not.toContain("<iframe")
      expect(result).not.toContain("<script>")
    })
  })

  // Data URI XSS
  describe("data URI XSS", () => {
    it("strips data URI with HTML payload in anchor href", () => {
      const result = sanitizeUserInput(
        '<a href="data:text/html,<script>alert(1)</script>">click</a>'
      )
      expect(result).not.toContain("data:text/html")
    })

    it("strips data URI with base64 payload", () => {
      const result = sanitizeUserInput(
        '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>'
      )
      expect(result).not.toContain("data:")
    })
  })

  // Encoding bypasses
  describe("encoding bypasses", () => {
    it("handles HTML entity encoded script tags", () => {
      const result = sanitizeUserInput("&#60;script&#62;alert(1)&#60;/script&#62;")
      expect(result).not.toContain("<script>")
      // DOMPurify decodes entities first, so the script tag should be stripped
    })

    it("strips hex-encoded javascript protocol", () => {
      const result = sanitizeUserInput(
        '<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3A;alert(1)">click</a>'
      )
      expect(result).not.toContain("javascript:")
      expect(result).not.toContain("alert(1)")
    })

    it("strips mixed-case javascript protocol", () => {
      const result = sanitizeUserInput(
        '<a href="JaVaScRiPt:alert(1)">click</a>'
      )
      expect(result).not.toContain("alert(1)")
    })

    it("strips javascript protocol with tab characters", () => {
      const result = sanitizeUserInput(
        '<a href="ja\tvascript:alert(1)">click</a>'
      )
      expect(result).not.toContain("alert(1)")
    })
  })

  // Meta/base tag injection
  describe("meta and base tag injection", () => {
    it("strips meta refresh tag", () => {
      const result = sanitizeUserInput(
        '<meta http-equiv="refresh" content="0;url=https://evil.com">'
      )
      expect(result).not.toContain("<meta")
      expect(result).not.toContain("evil.com")
    })

    it("strips base tag", () => {
      const result = sanitizeUserInput('<base href="https://evil.com/">')
      expect(result).not.toContain("<base")
      expect(result).not.toContain("evil.com")
    })
  })

  // Null bytes in HTML
  describe("null byte injection", () => {
    it("handles null bytes within script tag name", () => {
      const result = sanitizeUserInput("<scr\x00ipt>alert(1)</script>")
      // DOMPurify strips the null byte, reconstitutes <script>, then strips
      // the tag — but "alert(1)" may remain as safe text content.
      // The key assertion is that no executable script tag survives.
      expect(result).not.toContain("<script>")
    })

    it("handles null bytes in attribute values", () => {
      const result = sanitizeUserInput('<img src=x onerr\x00or="alert(1)">')
      expect(result).not.toContain("alert(1)")
    })
  })

  // Comment-based bypass
  describe("comment-based bypass", () => {
    it("strips script inside HTML comment bypass", () => {
      const result = sanitizeUserInput(
        "<!--><script>alert(1)</script-->"
      )
      expect(result).not.toContain("<script>")
      expect(result).not.toContain("alert(1)")
    })

    it("strips conditional comment vectors", () => {
      const result = sanitizeUserInput(
        "<!--[if gte IE 4]><script>alert(1)</script><![endif]-->"
      )
      expect(result).not.toContain("<script>")
      expect(result).not.toContain("alert(1)")
    })
  })

  // Object/embed tags
  describe("object and embed tag injection", () => {
    it("strips object tags", () => {
      const result = sanitizeUserInput(
        '<object data="data:text/html,<script>alert(1)</script>"></object>'
      )
      expect(result).not.toContain("<object")
      expect(result).not.toContain("<script>")
    })

    it("strips embed tags with javascript src", () => {
      const result = sanitizeUserInput(
        '<embed src="javascript:alert(1)">'
      )
      expect(result).not.toContain("<embed")
      expect(result).not.toContain("javascript:")
    })

    it("strips embed tags with any src", () => {
      const result = sanitizeUserInput(
        '<embed src="https://evil.com/payload.swf" type="application/x-shockwave-flash">'
      )
      expect(result).not.toContain("<embed")
    })
  })

  // Form with malicious action
  describe("form-based XSS", () => {
    it("strips button formaction with javascript protocol", () => {
      const result = sanitizeUserInput(
        '<button formaction="javascript:alert(1)">Submit</button>'
      )
      expect(result).not.toContain("javascript:")
      expect(result).not.toContain("formaction")
    })

    it("strips form action with javascript protocol", () => {
      const result = sanitizeUserInput(
        '<form action="javascript:alert(1)"><input type="submit"></form>'
      )
      expect(result).not.toContain("javascript:")
    })
  })

  // Performance and edge cases
  describe("performance and edge cases", () => {
    it("handles very long input (1M characters)", () => {
      const longInput = "a".repeat(1_000_000)
      const result = sanitizeUserInput(longInput)
      expect(result).toBe(longInput)
    })

    it("handles deeply nested tags (1000 levels)", () => {
      const openTags = "<div>".repeat(1000)
      const closeTags = "</div>".repeat(1000)
      const input = openTags + "content" + closeTags
      const result = sanitizeUserInput(input)
      expect(result).toContain("content")
      expect(result).not.toContain("<script>")
    })

    it("handles null input gracefully", () => {
      const result = sanitizeUserInput(null as unknown as string)
      expect(result).toBeDefined()
    })
  })

  // Preserves legitimate content
  describe("preserves legitimate content", () => {
    it("preserves text with special characters used in code", () => {
      const input = "if (x < 5 && y > 3)"
      const result = sanitizeUserInput(input)
      // DOMPurify may parse < as start of tag; the key thing is
      // the logical meaning is preserved in the output
      expect(result).toContain("if (x")
      expect(result).toContain("y &gt; 3)")
    })

    it("preserves legitimate anchor tags", () => {
      const input = '<a href="https://example.com">safe link</a>'
      const result = sanitizeUserInput(input)
      expect(result).toContain("https://example.com")
      expect(result).toContain("safe link")
    })

    it("preserves code blocks with angle brackets", () => {
      const input = "<code>const arr = [1, 2, 3];</code>"
      const result = sanitizeUserInput(input)
      expect(result).toContain("<code>")
      expect(result).toContain("const arr = [1, 2, 3];")
    })

    it("preserves plain text with ampersands", () => {
      const input = "Tom & Jerry"
      const result = sanitizeUserInput(input)
      expect(result).toContain("Tom")
      expect(result).toContain("Jerry")
    })
  })
})
