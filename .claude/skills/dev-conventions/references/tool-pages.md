# Tool Pages Architecture

All tool pages under `src/apps/tools/` MUST use the shared `ToolLayout` component for consistency.

## Basic Usage

```tsx
import { ToolLayout } from "@/apps/tools/shared/components/ToolLayout";

<ToolLayout
    lang={lang}
    slug="tool/tool-name"
    title={t("tool.title")}
    subtitle={t("tool.subtitle")}
    aboutTitle={t("tool.aboutTitle")}
    aboutContent={t("tool.aboutDesc")}
    maxWidth="md"  // "sm" | "md" | "lg" | "xl"
>
    {/* Tool content */}
</ToolLayout>
```

## What ToolLayout Provides

- **Consistent header**: Title + subtitle with unified styling
- **ToolStats component**: Views/likes counter in top-left corner
- **About/info card**: Collapsible info section at bottom
- **PoweredBy footer**: Branding footer
- **Navigation arrows**: Left/right arrows to switch between tools (desktop only)
- **Responsive container**: Design token-based max-widths

## Container Width Guidelines

Choose `maxWidth` based on content complexity:

| Width | Size | Use Case | Example |
|-------|------|----------|---------|
| `sm` | 640px | Simple UI, minimal controls | screen-checker |
| `md` | 768px | Default for most tools | muyu-timer, screen-ruler |
| `lg` | 1024px | Wide layouts, side-by-side content | shizai-calendar |
| `xl` | 1280px | Reserved for future complex tools | - |

## Embed Mode

For tools that support embedding, return content directly without ToolLayout:

```tsx
const MyTool = ({ isEmbed = false }) => {
    const content = (
        <div>
            {/* Tool UI */}
        </div>
    );

    if (isEmbed) {
        return content;
    }

    return (
        <ToolLayout {...props}>
            {content}
        </ToolLayout>
    );
};
```

## Do NOT

- ❌ Add custom headers, titles inside tool components
- ❌ Add PoweredBy components manually
- ❌ Create custom wrapper divs with max-width
- ❌ Add ToolStats in `.astro` pages (ToolLayout handles it)
- ❌ Duplicate navigation or layout elements

## Design Tokens

ToolLayout uses design tokens from `src/styles/tokens/_spacing.scss`:

- `--container-sm`: 40rem (640px)
- `--container-md`: 48rem (768px)
- `--container-lg`: 64rem (1024px)
- `--container-xl`: 80rem (1280px)

## Tool Navigation

Tools are automatically linked in a circular navigation order defined in `src/apps/tools/shared/toolsConfig.ts`. 

**IMPORTANT**: When creating a new tool, you MUST add it to `toolsConfig.ts`:

1. Add the tool entry to the `TOOLS` array in `src/apps/tools/shared/toolsConfig.ts`
2. The navigation arrows will automatically include it in the left/right tool navigation

## Checklist for New Tools

When creating a new tool:

- [ ] Use ToolLayout component with appropriate `maxWidth`
- [ ] Add i18n keys for title, subtitle, aboutTitle, aboutDesc
- [ ] Do NOT add ToolStats to `.astro` page (ToolLayout handles it)
- [ ] Do NOT add custom header/footer inside tool component
- [ ] **MUST add tool to `src/apps/tools/shared/toolsConfig.ts` for navigation arrows**
- [ ] Support embed mode if tool will be embedded elsewhere
- [ ] Use SCSS modules for styling (no Tailwind)
- [ ] Use design tokens for spacing, colors, typography
