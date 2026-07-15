---
name: api-architect
description: Design RESTful and GraphQL APIs with proper resource modeling, versioning, pagination, error handling, and OpenAPI documentation. Use this skill when the user needs to design an API, define endpoints, choose between REST and GraphQL, create an OpenAPI spec, implement pagination, handle API errors, design webhooks, or structure any API. Also trigger for "API design", "REST", "GraphQL", "OpenAPI", "Swagger", "endpoint design", "API versioning", "webhooks", or "API error handling".
---

# API Architect — Design Robust APIs

Design consistent, developer-friendly APIs that scale.

## REST vs GraphQL Decision

| Choose REST when... | Choose GraphQL when... |
|--------------------|-----------------------|
| Simple CRUD operations | Multiple related resources per request |
| Caching is critical (HTTP caching) | Frontend needs flexible data shapes |
| Public API for third parties | Rapid frontend iteration |
| Simple data relationships | Deeply nested relationships |
| Team is REST-experienced | Multiple client types (web, mobile, IoT) |

## RESTful API Design

### Resource Naming

```
# Nouns (plural), not verbs
GET    /api/v1/projects              # List projects
POST   /api/v1/projects              # Create project
GET    /api/v1/projects/:id          # Get project
PATCH  /api/v1/projects/:id          # Partial update
PUT    /api/v1/projects/:id          # Full replace
DELETE /api/v1/projects/:id          # Delete project

# Nested resources for strong parent-child
GET    /api/v1/projects/:id/tasks    # List project tasks
POST   /api/v1/projects/:id/tasks    # Create task in project

# Actions as sub-resources (when CRUD doesn't fit)
POST   /api/v1/projects/:id/archive  # Archive a project
POST   /api/v1/projects/:id/clone    # Clone a project

# Query parameters for filtering, sorting, pagination
GET    /api/v1/projects?status=active&sort=-created_at&page=2&limit=20
```

### HTTP Status Codes

```
# Success
200 OK              — GET, PATCH, PUT succeeded
201 Created         — POST created a resource (include Location header)
204 No Content      — DELETE succeeded (no body)

# Client Errors
400 Bad Request     — Invalid input (validation errors)
401 Unauthorized    — No/invalid authentication
403 Forbidden       — Authenticated but not authorized
404 Not Found       — Resource doesn't exist
409 Conflict        — Duplicate, version conflict
422 Unprocessable   — Valid JSON, business rule violation
429 Too Many Reqs   — Rate limited (include Retry-After header)

# Server Errors
500 Internal Error  — Unexpected failure
503 Service Unavail — Temporarily down (include Retry-After)
```

### Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "field": "email",
        "message": "Must be a valid email address",
        "value": "not-an-email"
      },
      {
        "field": "name",
        "message": "Required field",
        "value": null
      }
    ]
  },
  "request_id": "req_abc123"
}
```

### Pagination

```json
// Cursor-based (recommended — stable, performant)
GET /api/v1/projects?limit=20&cursor=eyJpZCI6MTAwfQ

{
  "data": [...],
  "pagination": {
    "next_cursor": "eyJpZCI6MTIwfQ",
    "has_more": true,
    "limit": 20
  }
}

// Offset-based (simpler, but unstable with inserts/deletes)
GET /api/v1/projects?page=3&limit=20

{
  "data": [...],
  "pagination": {
    "page": 3,
    "limit": 20,
    "total": 247,
    "total_pages": 13
  }
}
```

### Filtering & Sorting

```
# Simple equality
GET /api/v1/projects?status=active&owner_id=123

# Operators (pick a convention and be consistent)
GET /api/v1/tasks?created_at[gte]=2026-01-01&priority[in]=high,critical

# Sorting (- prefix for descending)
GET /api/v1/projects?sort=-updated_at,name

# Field selection (reduce payload)
GET /api/v1/projects?fields=id,name,status
```

### Versioning

```
# URL path versioning (most common, simplest)
GET /api/v1/projects
GET /api/v2/projects

# Header versioning (cleaner URLs)
GET /api/projects
Accept: application/vnd.myapp.v2+json

# Recommendation: URL versioning for public APIs, header for internal
```

## Authentication Patterns

```
# Bearer token (JWT)
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...

# API key (for service-to-service)
X-API-Key: sk_live_abc123def456

# OAuth 2.0 flows
# Authorization Code — web apps with backend
# PKCE — SPAs and mobile apps
# Client Credentials — service-to-service
```

## Rate Limiting

```
# Response headers
X-RateLimit-Limit: 100        # Max requests per window
X-RateLimit-Remaining: 67     # Remaining in current window
X-RateLimit-Reset: 1640000000 # Window reset timestamp
Retry-After: 30               # Seconds to wait (on 429)

# Tiered limits
# Anonymous:     60/hour
# Authenticated: 1000/hour
# Premium:       10000/hour
```

## Webhooks Design

```json
// Webhook payload
POST https://customer-site.com/webhooks/myapp
Content-Type: application/json
X-Webhook-Signature: sha256=abc123...
X-Webhook-ID: wh_evt_abc123

{
  "id": "evt_123",
  "type": "project.created",
  "created_at": "2026-03-28T10:00:00Z",
  "data": {
    "id": "proj_456",
    "name": "New Project",
    "owner_id": "usr_789"
  }
}

// Webhook best practices:
// 1. Sign payloads (HMAC-SHA256) so receivers can verify authenticity
// 2. Include idempotency key (event ID) so receivers can deduplicate
// 3. Retry with exponential backoff (1s, 5s, 30s, 5m, 1h)
// 4. Respond to 2xx within 5 seconds — process async if needed
// 5. Allow customers to configure which events they receive
```

## OpenAPI Specification

```yaml
openapi: 3.1.0
info:
  title: Project API
  version: 1.0.0
  description: API for managing projects

servers:
  - url: https://api.example.com/v1

paths:
  /projects:
    get:
      summary: List projects
      operationId: listProjects
      tags: [Projects]
      parameters:
        - name: status
          in: query
          schema:
            type: string
            enum: [active, archived]
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
            maximum: 100
      responses:
        '200':
          description: Project list
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/Project'
    post:
      summary: Create project
      operationId: createProject
      tags: [Projects]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateProject'
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Project'

components:
  schemas:
    Project:
      type: object
      required: [id, name, status, created_at]
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        status:
          type: string
          enum: [active, archived]
        created_at:
          type: string
          format: date-time

    CreateProject:
      type: object
      required: [name]
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 200
        description:
          type: string
          maxLength: 2000

  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

security:
  - bearerAuth: []
```

## Guidelines

- Consistent naming: pick `camelCase` or `snake_case` for response fields and stick with it
- Always return a `request_id` for debugging — correlate across logs
- Use `PATCH` for partial updates, `PUT` only for full replacements
- Idempotency: `POST` with `Idempotency-Key` header for safe retries
- Envelope your responses: `{ "data": ..., "pagination": ... }` — easier to extend
- Document every endpoint — if it's not in the spec, it doesn't exist
- Version from day one — even if you start with v1 and never change
