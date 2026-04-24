# API & Astro Actions

## OpenAPI spec

`src/pages/console/openapi.yml.ts` documents all actions. **Whenever a new action is added or an existing one changes its input/output shape, update the spec in the same commit.**

Add new entries under the appropriate tag (`Public`, `Admin`, `RSS Feeds`, etc.).

Pattern for a new action entry:

```yaml
/_actions/adminMyAction:
  post:
    summary: One-line description
    tags: [Admin]
    security:
      - cookieAuth: []
    requestBody:
      content:
        application/json:
          schema:
            type: object
            properties:
              myParam: { type: string }
            required: [myParam]
    responses:
      '200':
        description: OK
        content:
          application/json:
            schema:
              type: object
              properties:
                success: { type: boolean }
      '401':
        description: Unauthorized
```

## Action naming

- Public actions: camelCase, no prefix — `getLikes`, `submitComment`
- Admin actions: `admin` prefix — `adminGetComments`, `adminFetchFeed`

## Auth guard

All admin actions must call `verifyAuth` at the top of the handler:

```ts
if (!(await verifyAuth(context))) throw new Error("Unauthorized");
```
