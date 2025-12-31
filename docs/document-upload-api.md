# Document Upload API Documentation

## Overview

The Document Upload API allows users to upload various file types (PDFs, images, documents, spreadsheets) to their projects. Uploaded files are automatically processed, text is extracted, and the content is integrated into the RAG (Retrieval-Augmented Generation) system for AI-powered chat responses.

## Base URL

```
/api/v1/projects/:projectId/documents
```

## Authentication

All endpoints require authentication via Bearer token in the Authorization header:

```
Authorization: Bearer <access_token>
```

---

## Supported File Types

| Category | Extensions | MIME Types | Max Size |
|----------|-----------|------------|----------|
| **Documents** | `.pdf` | `application/pdf` | 50MB |
| **Documents** | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 25MB |
| **Documents** | `.doc` | `application/msword` | 25MB |
| **Documents** | `.txt` | `text/plain` | 10MB |
| **Documents** | `.md` | `text/markdown` | 10MB |
| **Documents** | `.rtf` | `application/rtf` | 10MB |
| **Spreadsheets** | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 25MB |
| **Spreadsheets** | `.xls` | `application/vnd.ms-excel` | 25MB |
| **Spreadsheets** | `.csv` | `text/csv` | 25MB |
| **Presentations** | `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | 50MB |
| **Presentations** | `.ppt` | `application/vnd.ms-powerpoint` | 50MB |
| **Images (OCR)** | `.png` | `image/png` | 20MB |
| **Images (OCR)** | `.jpg`, `.jpeg` | `image/jpeg` | 20MB |
| **Images (OCR)** | `.gif` | `image/gif` | 20MB |
| **Images (OCR)** | `.webp` | `image/webp` | 20MB |
| **Images (OCR)** | `.bmp` | `image/bmp` | 20MB |
| **Images (OCR)** | `.tiff` | `image/tiff` | 20MB |
| **Other** | `.json` | `application/json` | 10MB |
| **Other** | `.xml` | `text/xml`, `application/xml` | 10MB |
| **Other** | `.html` | `text/html` | 10MB |

## Limits

| Limit | Value |
|-------|-------|
| Max files per project | 100 |
| Max storage per project | 500MB |
| Max file size | Varies by type (see above) |

---

## Endpoints

### 1. Upload Documents

Upload one or more files to a project for processing.

```
POST /api/v1/projects/:projectId/documents
```

#### Request

| Parameter | Type | Location | Required | Description |
|-----------|------|----------|----------|-------------|
| `projectId` | string | URL path | Yes | Project ID |
| `files` | File[] | Form data | Yes | One or more files to upload |

**Content-Type:** `multipart/form-data`

#### Example Request (JavaScript)

```javascript
const formData = new FormData();
formData.append('files', pdfFile);
formData.append('files', imageFile);
formData.append('files', docxFile);

const response = await fetch(`/api/v1/projects/${projectId}/documents`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  },
  body: formData
});

const data = await response.json();
```

#### Example Request (React with Axios)

```javascript
const uploadDocuments = async (projectId, files) => {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  
  const { data } = await axios.post(
    `/api/v1/projects/${projectId}/documents`,
    formData,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'multipart/form-data'
      }
    }
  );
  
  return data;
};
```

#### Response (202 Accepted)

```json
{
  "message": "3 file(s) queued for processing",
  "results": [
    {
      "fileName": "report.pdf",
      "status": "queued",
      "documentId": "507f1f77bcf86cd799439011"
    },
    {
      "fileName": "data.xlsx",
      "status": "queued",
      "documentId": "507f1f77bcf86cd799439012"
    },
    {
      "fileName": "invalid.exe",
      "status": "error",
      "error": "Unsupported file type: application/x-msdownload"
    }
  ]
}
```

#### Response Schema

```typescript
interface UploadResponse {
  message: string;
  results: Array<{
    fileName: string;
    status: "queued" | "error";
    documentId?: string;  // Present if status is "queued"
    error?: string;       // Present if status is "error"
  }>;
}
```

#### Error Responses

| Status | Code | Description |
|--------|------|-------------|
| 400 | `NO_FILES` | No files were provided in the request |
| 400 | `FILE_LIMIT_EXCEEDED` | Project has reached maximum file count (100) |
| 400 | `STORAGE_LIMIT_EXCEEDED` | Project has reached maximum storage (500MB) |
| 404 | `NOT_FOUND` | Project not found or not owned by user |
| 503 | `SERVICE_UNAVAILABLE` | File upload service is not configured |

---

### 2. List Documents

Get all documents for a project.

```
GET /api/v1/projects/:projectId/documents
```

#### Request

| Parameter | Type | Location | Required | Description |
|-----------|------|----------|----------|-------------|
| `projectId` | string | URL path | Yes | Project ID |

#### Example Request

```javascript
const response = await fetch(`/api/v1/projects/${projectId}/documents`, {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

const data = await response.json();
```

#### Response (200 OK)

```json
{
  "documents": [
    {
      "id": "507f1f77bcf86cd799439011",
      "fileName": "report.pdf",
      "mimeType": "application/pdf",
      "fileSize": 1048576,
      "status": "completed",
      "chunkCount": 15,
      "processedAt": "2024-01-15T10:30:00.000Z",
      "createdAt": "2024-01-15T10:25:00.000Z"
    },
    {
      "id": "507f1f77bcf86cd799439012",
      "fileName": "image.png",
      "mimeType": "image/png",
      "fileSize": 524288,
      "status": "processing",
      "chunkCount": 0,
      "createdAt": "2024-01-15T10:28:00.000Z"
    },
    {
      "id": "507f1f77bcf86cd799439013",
      "fileName": "corrupted.pdf",
      "mimeType": "application/pdf",
      "fileSize": 2097152,
      "status": "failed",
      "errorMessage": "Failed to extract text from PDF",
      "chunkCount": 0,
      "createdAt": "2024-01-15T10:20:00.000Z"
    }
  ],
  "total": 3,
  "totalStorageBytes": 3670016,
  "maxFiles": 100,
  "maxStorageBytes": 524288000
}
```

#### Response Schema

```typescript
interface ListDocumentsResponse {
  documents: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;           // In bytes
    status: "pending" | "processing" | "completed" | "failed";
    errorMessage?: string;      // Present if status is "failed"
    chunkCount: number;
    processedAt?: string;       // ISO 8601 date string
    createdAt: string;          // ISO 8601 date string
  }>;
  total: number;
  totalStorageBytes: number;
  maxFiles: number;             // Always 100
  maxStorageBytes: number;      // Always 524288000 (500MB)
}
```

---

### 3. Get Document Details

Get detailed information about a specific document.

```
GET /api/v1/projects/:projectId/documents/:documentId
```

#### Request

| Parameter | Type | Location | Required | Description |
|-----------|------|----------|----------|-------------|
| `projectId` | string | URL path | Yes | Project ID |
| `documentId` | string | URL path | Yes | Document ID |

#### Example Request

```javascript
const response = await fetch(
  `/api/v1/projects/${projectId}/documents/${documentId}`,
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  }
);

const data = await response.json();
```

#### Response (200 OK)

```json
{
  "document": {
    "id": "507f1f77bcf86cd799439011",
    "fileName": "report.pdf",
    "mimeType": "application/pdf",
    "fileSize": 1048576,
    "status": "completed",
    "chunkCount": 15,
    "extractedTextPreview": "This is the first 500 characters of the extracted text from the document...",
    "processedAt": "2024-01-15T10:30:00.000Z",
    "createdAt": "2024-01-15T10:25:00.000Z"
  }
}
```

#### Response Schema

```typescript
interface DocumentDetailsResponse {
  document: {
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    status: "pending" | "processing" | "completed" | "failed";
    errorMessage?: string;
    chunkCount: number;
    extractedTextPreview?: string;  // First 500 chars (only if completed)
    processedAt?: string;
    createdAt: string;
  };
}
```

#### Error Responses

| Status | Code | Description |
|--------|------|-------------|
| 404 | `NOT_FOUND` | Document or project not found |

---

### 4. Delete Document

Delete a document and all its associated data.

```
DELETE /api/v1/projects/:projectId/documents/:documentId
```

#### Request

| Parameter | Type | Location | Required | Description |
|-----------|------|----------|----------|-------------|
| `projectId` | string | URL path | Yes | Project ID |
| `documentId` | string | URL path | Yes | Document ID |

#### Example Request

```javascript
const response = await fetch(
  `/api/v1/projects/${projectId}/documents/${documentId}`,
  {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  }
);

const data = await response.json();
```

#### Response (200 OK)

```json
{
  "message": "Document deleted successfully"
}
```

#### Response Schema

```typescript
interface DeleteDocumentResponse {
  message: string;
}
```

#### Error Responses

| Status | Code | Description |
|--------|------|-------------|
| 404 | `NOT_FOUND` | Document or project not found |
| 500 | `DELETE_FAILED` | Failed to delete document |

---

### 5. Reprocess Failed Document

Retry processing a document that previously failed.

```
POST /api/v1/projects/:projectId/documents/:documentId/reprocess
```

#### Request

| Parameter | Type | Location | Required | Description |
|-----------|------|----------|----------|-------------|
| `projectId` | string | URL path | Yes | Project ID |
| `documentId` | string | URL path | Yes | Document ID |

#### Example Request

```javascript
const response = await fetch(
  `/api/v1/projects/${projectId}/documents/${documentId}/reprocess`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  }
);

const data = await response.json();
```

#### Response (202 Accepted)

```json
{
  "message": "Document queued for reprocessing"
}
```

#### Response Schema

```typescript
interface ReprocessResponse {
  message: string;
}
```

#### Error Responses

| Status | Code | Description |
|--------|------|-------------|
| 404 | `NOT_FOUND` | Document or project not found |
| 409 | `ALREADY_PROCESSING` | Document is currently being processed |
| 500 | `REPROCESS_FAILED` | Failed to queue document for reprocessing |

---

### 6. Get Document Stats

Get document processing statistics for a project.

```
GET /api/v1/projects/:projectId/documents/stats
```

#### Request

| Parameter | Type | Location | Required | Description |
|-----------|------|----------|----------|-------------|
| `projectId` | string | URL path | Yes | Project ID |

#### Example Request

```javascript
const response = await fetch(
  `/api/v1/projects/${projectId}/documents/stats`,
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  }
);

const data = await response.json();
```

#### Response (200 OK)

```json
{
  "documents": {
    "pending": 2,
    "processing": 1,
    "completed": 15,
    "failed": 1
  },
  "totalDocuments": 19,
  "totalChunks": 156,
  "storageUsedBytes": 52428800,
  "storageLimitBytes": 524288000,
  "storageUsedPercent": 10,
  "queue": {
    "queueLength": 3,
    "processing": 1
  }
}
```

#### Response Schema

```typescript
interface DocumentStatsResponse {
  documents: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  totalDocuments: number;
  totalChunks: number;
  storageUsedBytes: number;
  storageLimitBytes: number;      // Always 524288000 (500MB)
  storageUsedPercent: number;     // 0-100
  queue: {
    queueLength: number;          // Jobs waiting in queue
    processing: number;           // Jobs currently processing
  };
}
```

---

### 7. Get Supported File Types

Get list of supported file types and their limits.

```
GET /api/v1/projects/:projectId/documents/supported-types
```

#### Request

| Parameter | Type | Location | Required | Description |
|-----------|------|----------|----------|-------------|
| `projectId` | string | URL path | Yes | Project ID |

#### Example Request

```javascript
const response = await fetch(
  `/api/v1/projects/${projectId}/documents/supported-types`,
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  }
);

const data = await response.json();
```

#### Response (200 OK)

```json
{
  "supportedTypes": [
    {
      "mimeType": "application/pdf",
      "extension": "pdf",
      "category": "document",
      "maxSizeMB": 50
    },
    {
      "mimeType": "image/png",
      "extension": "png",
      "category": "image",
      "maxSizeMB": 20
    }
  ],
  "byCategory": {
    "document": [
      { "mimeType": "application/pdf", "extension": "pdf", "category": "document", "maxSizeMB": 50 }
    ],
    "image": [
      { "mimeType": "image/png", "extension": "png", "category": "image", "maxSizeMB": 20 }
    ],
    "spreadsheet": [],
    "presentation": [],
    "other": []
  },
  "limits": {
    "maxFileSizeMB": 50,
    "maxFilesPerProject": 100,
    "maxStoragePerProjectMB": 500
  }
}
```

#### Response Schema

```typescript
interface SupportedTypesResponse {
  supportedTypes: Array<{
    mimeType: string;
    extension: string;
    category: "document" | "spreadsheet" | "presentation" | "image" | "other";
    maxSizeMB: number;
  }>;
  byCategory: Record<string, Array<{
    mimeType: string;
    extension: string;
    category: string;
    maxSizeMB: number;
  }>>;
  limits: {
    maxFileSizeMB: number;
    maxFilesPerProject: number;
    maxStoragePerProjectMB: number;
  };
}
```

---

## Document Processing Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Upload     │────▶│   Pending    │────▶│  Processing  │────▶│  Completed   │
│   (POST)     │     │              │     │              │     │              │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                │                      │
                                                │                      │
                                                ▼                      ▼
                                          ┌──────────────┐     ┌──────────────┐
                                          │    Failed    │────▶│  Reprocess   │
                                          │              │     │    (POST)    │
                                          └──────────────┘     └──────────────┘
```

### Status Definitions

| Status | Description |
|--------|-------------|
| `pending` | File uploaded, waiting in queue for processing |
| `processing` | File is currently being processed (text extraction, chunking, embedding) |
| `completed` | File successfully processed and available for RAG queries |
| `failed` | Processing failed (can be retried via reprocess endpoint) |

---

## TypeScript Interfaces (Complete)

```typescript
// Document status type
type DocumentStatus = "pending" | "processing" | "completed" | "failed";

// Document object
interface Document {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: DocumentStatus;
  errorMessage?: string;
  chunkCount: number;
  extractedTextPreview?: string;
  processedAt?: string;
  createdAt: string;
}

// Upload response
interface UploadDocumentsResponse {
  message: string;
  results: Array<{
    fileName: string;
    status: "queued" | "error";
    documentId?: string;
    error?: string;
  }>;
}

// List documents response
interface ListDocumentsResponse {
  documents: Document[];
  total: number;
  totalStorageBytes: number;
  maxFiles: number;
  maxStorageBytes: number;
}

// Document details response
interface DocumentDetailsResponse {
  document: Document;
}

// Delete response
interface DeleteDocumentResponse {
  message: string;
}

// Reprocess response
interface ReprocessDocumentResponse {
  message: string;
}

// Stats response
interface DocumentStatsResponse {
  documents: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  totalDocuments: number;
  totalChunks: number;
  storageUsedBytes: number;
  storageLimitBytes: number;
  storageUsedPercent: number;
  queue: {
    queueLength: number;
    processing: number;
  };
}

// Supported types response
interface SupportedTypesResponse {
  supportedTypes: Array<{
    mimeType: string;
    extension: string;
    category: string;
    maxSizeMB: number;
  }>;
  byCategory: Record<string, Array<{
    mimeType: string;
    extension: string;
    category: string;
    maxSizeMB: number;
  }>>;
  limits: {
    maxFileSizeMB: number;
    maxFilesPerProject: number;
    maxStoragePerProjectMB: number;
  };
}

// Error response
interface ErrorResponse {
  error: string;
  code: string;
}
```

---

## Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `NO_FILES` | 400 | No files provided in upload request |
| `FILE_LIMIT_EXCEEDED` | 400 | Project has reached 100 file limit |
| `STORAGE_LIMIT_EXCEEDED` | 400 | Project has reached 500MB storage limit |
| `NOT_FOUND` | 404 | Project or document not found |
| `ALREADY_PROCESSING` | 409 | Document is currently being processed |
| `SERVICE_UNAVAILABLE` | 503 | Azure Blob Storage not configured |
| `DELETE_FAILED` | 500 | Failed to delete document |
| `REPROCESS_FAILED` | 500 | Failed to queue for reprocessing |

