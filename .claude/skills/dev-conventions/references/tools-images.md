# Tools (Mini-Apps), Images & Content Collections

## Mini-Apps / Tools

New tool structure:
```
src/apps/tools/<tool-name>/
  components/
    ToolName.tsx
    ToolName.module.scss
src/pages/tools/<tool-name>/index.astro
src/pages/en/tools/<tool-name>/index.astro
```

**Every tool page must mount `ToolStats`** from `src/apps/tools/shared/components/ToolStats.tsx` — this handles view/like tracking consistent with existing tools.

Tool pages use `export const prerender = true`. Because of this, **locale detection must be client-side**:
```ts
const isEn = window.location.pathname.startsWith('/en/');
```
`Astro.currentLocale` always returns `zh-tw` at build time for prerendered pages — never rely on it.

## Asset Management

### SVG Files
- **NEVER inline SVG content directly in code** (TSX/JSX files, template literals, or data URIs in CSS).
- **Custom/project-specific SVGs**: Store in `public/assets/` and reference via file paths: `/assets/path/to/file.svg`
- **External library SVGs** (e.g., from icon libraries, CDNs): Keep as external references, do NOT download locally.
- Use `<image href="...">` inside `<svg>` containers, or `<img src="...">` for standalone images.
- Exception: Small utility icons (< 100 bytes) in shared component libraries may use inline SVG for performance.

### Audio/Media Files
- Store all audio files in `public/assets/` (never use base64 encoding in code).
- Load via `fetch()` or direct `<audio src="...">` references.
- Organize by feature: `public/assets/tools/[tool-name]/audio/`

### File Organization
```
public/assets/
├── tools/
│   └── [tool-name]/
│       ├── audio/
│       └── images/
└── [other-categories]/
```

## Images

**Use `<Image>` from `astro:assets`** — not bare `<img>` tags:
```astro
import { Image } from "astro:assets";
<Image src={heroImage} alt="..." width={800} height={450} />
```

**For hero images in non-template code** (RSS, OG tags, API responses) use `resolveImage()` from `src/lib/images.ts`. It handles both local `ImageMetadata` and remote URL strings and returns an absolute URL.

**CSS aspect-ratio gotcha**: `<Image>` emits explicit `width`/`height` attrs that can override CSS `aspect-ratio`. Fix with a scoped global:
```scss
:global(.your-img-class) {
  width: 100%;
  height: auto;
  aspect-ratio: 16/9;
  object-fit: cover;
}
```

## Content Collections

**Use `getFilteredPosts({ lang })` from `src/lib/posts.ts`** — not raw `getCollection('blog')`. The helper excludes `draft: true` and test posts. Using `getCollection` directly risks leaking drafts into production.

For per-post lookups and URL generation use helpers from `src/lib/posts.ts`: `getPostHref`, `getSortedPosts`, `getPostSlug`.
