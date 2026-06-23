# ATS / CRM API Endpoints

> Base URL: `/api/v1`

## Clients

Mounted at: `/api/v1/ats/clients`

### `GET /`

List clients.

Query params:

| Param    | Type                                  | Notes                       |
| -------- | ------------------------------------- | --------------------------- |
| `status` | `active` \| `inactive` \| `suspended` | Filter by client status     |
| `search` | string                                | Full-text search on company |
| `page`   | number (default 1)                    | Pagination                  |
| `limit`  | number (default 20)                   | Pagination                  |

### `POST /`

Create a client. **`status` is not accepted** — new clients default to `active`.

### `GET /:id`

Retrieve a single client.

### `PATCH /:id`

Update a client. All fields are optional. The following fields are PATCH-able:

| Field         | Type                                                    | Notes                                                     |
| ------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| `companyName` | string (1–100)                                          |                                                           |
| `email`       | string (email)                                          |                                                           |
| `phone`       | string                                                  |                                                           |
| `website`     | string (URL) or `""`                                    |                                                           |
| `logo`        | string                                                  | Usually set via `POST /:id/logo`                          |
| `industry`    | string                                                  |                                                           |
| `companySize` | `1-10` \| `11-50` \| `51-200` \| `201-500` \| `500+`    | Self-healing — typos are remapped by the model middleware |
| **`status`**  | `active` \| `inactive` \| `suspended`                   | Enum matches the `GET` `status` query param               |
| `description` | string                                                  |                                                           |
| `address`     | object (`{ street, city, state, country, postalCode }`) | Merged onto the existing address                          |

Example — suspend a client:

```http
PATCH /api/v1/ats/clients/:id
Content-Type: application/json

{ "status": "suspended" }
```

Returns 200 with the updated client document.

### `DELETE /:id`

Delete a client. Fails with `CLIENT_HAS_ACTIVE_JOBS` if the client has any
jobs with status `open` or `on_hold`.

### `POST /:id/logo`

Upload a logo image (multipart form). Replaces any existing logo.

### Contacts sub-resource

- `POST   /:id/contacts`
- `PATCH  /:id/contacts/:contactId`
- `DELETE /:id/contacts/:contactId`

### CRM profile sub-resource

- `PATCH /:id/crm-profile` — updates fields on the CRM profile document.

### Notes sub-resource

- `POST   /:clientId/notes` — `{ method, content }`, author auto-populated
- `GET    /:clientId/notes` — newest-first
- `PATCH  /:clientId/notes/:noteId` — partial update
- `DELETE /:clientId/notes/:noteId`

Where `method ∈ { call, email, meeting, message, other }`.

## Candidates

Mounted at: `/api/v1/ats/candidates`

### `GET /`

List candidates.

Query params:

| Param          | Type                     | Notes                      |
| -------------- | ------------------------ | -------------------------- |
| `status`       | string                   | Filter by candidate status |
| `inTalentPool` | boolean                  | Filter talent pool         |
| `search`       | string                   | Full-text search           |
| `tags`         | string (comma-separated) | Filter by tag IDs          |
| `page`         | number (default 1)       | Pagination                 |
| `limit`        | number (default 20)      | Pagination                 |

### `POST /`

Create a candidate. Requires a resume file (multipart form).

### `GET /:id`

Retrieve a single candidate.

### `PATCH /:id`

Update a candidate. All fields are optional.

| Field               | Type     | Notes                                                                                              |
| ------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `firstName`         | string   |                                                                                                    |
| `lastName`          | string   |                                                                                                    |
| `phone`             | string   |                                                                                                    |
| `videoIntroUrl`     | string   |                                                                                                    |
| `videoIntroSource`  | string   | `cloudinary` \| `external`                                                                         |
| `yearsOfExperience` | number   |                                                                                                    |
| `tags`              | string[] | Array of tag IDs                                                                                   |
| `parsedData`        | object   | Optional. Shape: `{ summary, skills[], languages[], certifications[], experience[], education[] }` |

### `DELETE /:id`

Delete a candidate.

### `POST /:id/avatar`

Upload an avatar image (multipart form).

### `PATCH /:id/talent-pool`

Add or remove a candidate from the talent pool. Body: `{ action: 'add' | 'remove', notes?: string }`.
