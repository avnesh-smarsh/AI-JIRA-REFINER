# Implementation Journey - Raw Storage Service

**Team:** Adarsh, Vachan, Avnesh, Manan, Anand  
**Timeline:** Sprint 3-4 (2 weeks)  
**Tech Stack:** Spring Boot, AWS S3, Java REST API

---

## Thread 1: PRD Review & Initial Questions (Monday Week 1, 9am)

**Manan Kumar:** just got the PRD from product for raw storage service

**Manan Kumar:** basically we need S3-backed storage for original message payloads. preserve everything for compliance

**Adarsh Maurya:** why separate service? can't canonical just write to S3 directly?

**Vachan Jalady:** isolation + reusability

**Vachan Jalady:** if we put S3 logic in canonical, every service that needs raw storage would duplicate code

**Vachan Jalady:** centralized service = single place for storage logic, quotas, encryption, etc

**Manan Kumar:** yup plus PRD mentions multi-tenancy, tiered encryption (KMS vs SSE-S3), quotas

**Manan Kumar:** that's a lot of cross-cutting concerns. better in one service

**Avnesh Kumar:** endpoints needed?

**Manan Kumar:** POST /payloads (store), GET /payloads/{id} (retrieve), DELETE /payloads/{id} (delete)

**Manan Kumar:** also POST /payloads/export for bulk exports, DELETE /objects for batch deletes

**Anand Kummari:** I can take storage service layer + S3 integration

**Avnesh Kumar:** I'll do controllers + REST API

**Vachan Jalady:** me and @Manan can handle deletion policies + metadata management

---

## Thread 2: S3 Bucket Design Discussion (Monday Week 1, 2pm)

**Anand Kummari:** working on S3 structure

**Anand Kummari:** question: flat structure `bucket/tenantId/messageId` or hierarchical `bucket/tenantId/YYYY/MM/DD/messageId`?

**Vachan Jalady:** hierarchical 100%

**Vachan Jalady:** lifecycle policies need date-based paths. can't do "move to glacier after 90 days" with flat structure

**Manan Kumar:** but hierarchical = more S3 keys. performance impact?

**Anand Kummari:** checked AWS docs - no performance impact

**Anand Kummari:** S3 uses key prefixes for partitioning anyway. hierarchical actually helps distribution

**Adarsh Maurya:** also easier for debugging

**Adarsh Maurya:** if tenant reports missing files from "last week", we just look in last week's folders

**Anand Kummari:** k implementing: `{tenantId}/YYYY/MM/DD/{messageId}.json`

**Anand Kummari:** using KeyBuilder util class to generate consistent paths

---

## Thread 3: Encryption Strategy Implementation (Tuesday Week 1, 10am)

**Anand Kummari:** encryption question

**Anand Kummari:** PRD says tiered: enterprise gets KMS, others get SSE-S3

**Anand Kummari:** but how do we know tenant tier? where's that stored?

**Vachan Jalady:** tenant config in canonical service DB

**Vachan Jalady:** we'd need to call canonical API to check tier

**Manan Kumar:** or pass it in request header?

**Manan Kumar:** `X-Tenant-Tier: ENTERPRISE` from client

**Adarsh Maurya:** nah don't trust client headers for billing-related stuff

**Adarsh Maurya:** call tenant config service (or canonical) to fetch tier

**Anand Kummari:** adding TenantConfigService that fetches via REST

**Anand Kummari:** caches tier in memory for 5min to reduce calls

**Anand Kummari:** encryption logic: if tier == ENTERPRISE → use KMS, else → SSE-S3

---

## Thread 4: Code Review - Storage Service (Wednesday Week 1, 11am)

**Vachan Jalady:** reviewing @Anand's PayloadStorageService

**Vachan Jalady:** looks solid but one thing... storePayload() doesn't handle multipart uploads

**Vachan Jalady:** PRD says support up to 50MB files. single PUT will timeout

**Anand Kummari:** oh yeah good catch

**Anand Kummari:** adding multipart logic: if size > 10MB → use multipart with 5MB chunks

**Avnesh Kumar:** also in S3ObjectStore you're not setting Content-Type

**Avnesh Kumar:** should preserve original content type for downloads

**Anand Kummari:** adding: `.contentType(request.getContentType())`

**Anand Kummari:** also metadata like uploadedBy, uploadedAt going into S3 object metadata

---

## Thread 5: Deletion Policy Challenge (Thursday Week 1, 3pm)

**Manan Kumar:** working on deletion policies

**Manan Kumar:** we have CompositeDeletionPolicy and TenantScopePolicy

**Manan Kumar:** but hitting issue... tenant tries to delete another tenant's file = doesn't fail 😬

**Vachan Jalady:** TenantScopePolicy should prevent that

**Vachan Jalady:** it checks if requestor's tenantId matches file's tenantId

**Manan Kumar:** yeah but extracting tenantId from S3 key is failing

**Manan Kumar:** key structure is `tenant-123/2025/12/04/msg-456.json` but parser expects different format

**Vachan Jalady:** check TenantKeyNormalizer

**Vachan Jalady:** it's supposed to extract tenantId from key prefix

**Manan Kumar:** oh I see it... regex is wrong. expects `{tenant}/` but our keys are `tenant-{id}/`

**Manan Kumar:** fixing KeyNormalizer regex pattern

**Manan Kumar:** testing... ok tenant isolation working now ✅

---

## Thread 6: Write-Once Guard Implementation (Friday Week 1, 9am)

**Anand Kummari:** added WriteOnceGuardedObjectStore decorator

**Anand Kummari:** prevents overwriting existing files for compliance

**Avnesh Kumar:** how's it work?

**Anand Kummari:** before every PUT, checks if object exists

**Anand Kummari:** if exists → throw ConflictException (409)

**Anand Kummari:** uses S3 headObject() call

**Adarsh Maurya:** that's an extra API call per upload

**Adarsh Maurya:** at high throughput that adds latency + costs

**Anand Kummari:** hmm true

**Anand Kummari:** compromise: cache "known existing keys" in Redis with TTL

**Anand Kummari:** check cache first, only call S3 if not in cache

**Vachan Jalady:** or use S3 conditional puts?

**Vachan Jalady:** `If-None-Match: *` header = only write if doesn't exist

**Anand Kummari:** oh that's perfect

**Anand Kummari:** S3 handles atomically, no extra call needed

**Anand Kummari:** switching to conditional puts

---

## Thread 7: Batch Operations Testing (Monday Week 2, 10am)

**Avnesh Kumar:** testing batch endpoints

**Avnesh Kumar:** POST /payloads/batch with 100 files

**Avnesh Kumar:** working but slow... taking like 30 seconds

**Manan Kumar:** are you uploading sequentially?

**Avnesh Kumar:** yeah... for loop through files, upload one by one

**Manan Kumar:** parallelize it

**Manan Kumar:** use CompletableFuture.allOf() to upload in parallel

**Avnesh Kumar:** trying... ok down to 3 seconds for 100 files 🚀

**Avnesh Kumar:** also added BatchStoreResponse with per-file status

**Avnesh Kumar:** {stored: 95, failed: 5, items: [{id, status, error}]}

**Adarsh Maurya:** nice. partial success handling is important

---

## Thread 8: Export & Pre-signed URLs (Tuesday Week 2, 2pm)

**Avnesh Kumar:** implementing export endpoint

**Avnesh Kumar:** POST /payloads/export with messageIds array

**Avnesh Kumar:** should return pre-signed URLs or download through our service?

**Vachan Jalady:** pre-signed URLs

**Vachan Jalady:** users download directly from S3, saves our bandwidth

**Adarsh Maurya:** security concern tho

**Adarsh Maurya:** pre-signed URL can be shared. anyone with URL can download

**Avnesh Kumar:** URLs expire after 24hrs

**Avnesh Kumar:** also we log URL generation for audit: {action: EXPORT_LINK_CREATED, actor, fileIds, expiresAt}

**Manan Kumar:** that works. if URL leaks it's only valid for 24hrs

**Avnesh Kumar:** implementing with S3LinkFactory

**Avnesh Kumar:** generates pre-signed URLs with configurable expiry

---

## Thread 9: Quota Enforcement Bug (Wednesday Week 2, 11am)

**Manan Kumar:** found bug in quota enforcement 😤

**Manan Kumar:** tenant uploads 100GB (quota is 100GB), next upload should fail but it's allowing

**Vachan Jalady:** check QuotaService

**Vachan Jalady:** are you checking BEFORE upload or AFTER?

**Manan Kumar:** checking before but...

**Manan Kumar:** oh wait, quota check is `currentUsage + fileSize <= quota`

**Manan Kumar:** should be `<` not `<=`. at exactly 100GB we should reject

**Manan Kumar:** also currentUsage is stale - Redis cache with 1hr TTL

**Vachan Jalady:** reduce TTL to 5min

**Vachan Jalady:** or invalidate cache on every upload

**Manan Kumar:** invalidating on upload

**Manan Kumar:** also adding warning at 80% quota via email notification

---

## Thread 10: Integration Testing (Thursday Week 2, 9am)

**Adarsh Maurya:** running integration tests

**Adarsh Maurya:** test suite: store → retrieve → delete → verify gone

**Adarsh Maurya:** all passing except multipart upload test

**Anand Kummari:** what's failing?

**Adarsh Maurya:** uploading 25MB file, only getting back 5MB on retrieve

**Anand Kummari:** checking multipart complete logic...

**Anand Kummari:** oh crap I'm not calling completeMultipartUpload()

**Anand Kummari:** uploaded parts but never finalized them

**Anand Kummari:** adding: uploadParts() → completeMultipartUpload() → return ETag

**Adarsh Maurya:** rerunning... green ✅

---

## Thread 11: Error Handling Review (Thursday Week 2, 3pm)

**Avnesh Kumar:** added GlobalExceptionHandler

**Avnesh Kumar:** maps exceptions to proper HTTP codes:
- NotFoundException → 404
- ConflictException → 409  
- ForbiddenException → 403
- S3Exception → 503

**Adarsh Maurya:** what about retryable vs non-retryable errors?

**Adarsh Maurya:** 404 shouldn't retry, 503 should

**Avnesh Kumar:** good point

**Avnesh Kumar:** adding Retry-After header to 503 responses

**Avnesh Kumar:** also ApiErrorCode enum for structured error codes

**Vachan Jalady:** add request ID tracking too

**Vachan Jalady:** correlate errors across services

**Avnesh Kumar:** added RequestIdFilter

**Avnesh Kumar:** generates UUID per request, includes in all log lines + error responses

---

## Thread 12: Performance Load Testing (Friday Week 2, 10am)

**Manan Kumar:** load testing with JMeter

**Manan Kumar:** 1000 req/sec sustained for 5min

**Manan Kumar:** results: p50=45ms, p95=120ms, p99=300ms

**Manan Kumar:** CPU at 25%, S3 rate limits not hit

**Adarsh Maurya:** that's for small files right? what about large ones?

**Manan Kumar:** testing 10MB files... p50=800ms, p95=2s

**Manan Kumar:** acceptable for large files

**Vachan Jalady:** concurrent uploads per tenant?

**Manan Kumar:** tested 100 concurrent from same tenant

**Manan Kumar:** no throttling, all succeeded

**Manan Kumar:** S3 scales horizontally so we're good

---

## Thread 13: Metadata PostgreSQL Schema (Friday Week 2, 2pm)

**Vachan Jalady:** added metadata tracking

**Vachan Jalady:** postgres table: raw_storage_metadata

```sql
CREATE TABLE raw_storage_metadata (
  message_id VARCHAR(255) PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  s3_bucket VARCHAR(255),
  s3_key VARCHAR(500),
  file_size BIGINT,
  content_type VARCHAR(100),
  content_hash VARCHAR(64),
  uploaded_at TIMESTAMP,
  uploaded_by VARCHAR(255),
  INDEX idx_tenant_uploaded (tenant_id, uploaded_at)
);
```

**Manan Kumar:** content_hash - computing on upload?

**Vachan Jalady:** async

**Vachan Jalady:** upload to S3 → store metadata with null hash → async job computes SHA256 → update hash

**Vachan Jalady:** don't want to block upload for hash computation

**Anand Kummari:** how long does hash take for 50MB file?

**Vachan Jalady:** ~500ms

**Vachan Jalady:** acceptable as async, too slow for sync path

---

## Thread 14: Final Code Review (Monday Week 3, 9am)

**Adarsh Maurya:** final review before staging deploy

**Adarsh Maurya:** checked:
✅ S3 hierarchical structure implemented
✅ Tiered encryption (KMS/SSE-S3) working
✅ Multipart uploads for large files
✅ Pre-signed URL export
✅ Quota enforcement with warnings
✅ Metadata tracking in postgres
✅ Write-once guard preventing overwrites
✅ Proper error handling + request IDs
✅ Tenant isolation via deletion policies

**Vachan Jalady:** monitoring setup?

**Anand Kummari:** prometheus metrics at /actuator/prometheus

**Anand Kummari:** tracking: upload_count, upload_duration, s3_errors, quota_violations

**Avnesh Kumar:** logging to ../logs with logback

**Avnesh Kumar:** structured JSON logs with request IDs

**Manan Kumar:** deployment pipeline configured?

**Manan Kumar:** dev → staging → prod with approval gates

**Adarsh Maurya:** yup all set

**Adarsh Maurya:** deploying to staging now... ✅

---

## Thread 15: Staging Validation (Tuesday Week 3, 10am)

**Avnesh Kumar:** staging deployment successful

**Avnesh Kumar:** ran smoke tests - all endpoints responding

**Manan Kumar:** testing real uploads from canonical service

**Manan Kumar:** canonical → POST /payloads → S3 → returns location ✅

**Manan Kumar:** retrieval working, deletion working

**Adarsh Maurya:** checking S3 bucket structure...

**Adarsh Maurya:** files in correct hierarchical format ✅

**Adarsh Maurya:** encryption verified - enterprise tenant using KMS ✅

**Vachan Jalady:** metadata postgres queries fast?

**Vachan Jalady:** tested query: "find all files for tenant in last 7 days"

**Vachan Jalady:** with index: 15ms for 100k records. good

**Anand Kummari:** lifecycle policies configured?

**Anand Kummari:** glacier after 90 days ✅, delete after 7 years ✅

**Manan Kumar:** 24hr soak test starting

**Manan Kumar:** monitoring for errors, memory leaks, S3 throttling

---

## Thread 16: Production Deploy (Wednesday Week 3, 2pm)

**Adarsh Maurya:** soak test results: zero errors, stable memory, no throttling

**Adarsh Maurya:** ready for prod deploy

**Manan Kumar:** double-checking prod configs:
- S3 bucket: complyvault-raw-prod ✅
- KMS key ARN configured ✅  
- Postgres connection pool sized ✅
- Rate limits configured ✅

**Avnesh Kumar:** backup plan if deploy fails?

**Adarsh Maurya:** rollback to previous version via deployment pipeline

**Adarsh Maurya:** also canonical service has fallback to local temp storage

**Vachan Jalady:** deploying to prod...

**Vachan Jalady:** health check passing ✅

**Vachan Jalady:** traffic ramping up... 10%... 50%... 100% ✅

**Manan Kumar:** monitoring dashboards looking good

**Manan Kumar:** upload latency nominal, error rate 0.01%

**Adarsh Maurya:** raw storage service is LIVE 🚀

**Anand Kummari:** first production upload from canonical... SUCCESS ✅

**Avnesh Kumar:** we did it team 🎉

---

## Summary

**Implementation Timeline:**
- Week 1: Core storage logic, S3 integration, encryption, policies
- Week 2: Batch operations, export, quota enforcement, metadata
- Week 3: Testing, staging validation, production deploy

**Key Challenges Solved:**
1. Tenant isolation via KeyNormalizer and deletion policies
2. Write-once guard using S3 conditional puts
3. Multipart upload performance with parallelization
4. Quota enforcement with real-time cache invalidation
5. Async hash computation to avoid blocking uploads

**Final Architecture:**
- Hierarchical S3 structure: `{tenant}/YYYY/MM/DD/{messageId}`
- Tiered encryption: KMS (enterprise) vs SSE-S3 (standard)
- Metadata in PostgreSQL for fast queries
- Pre-signed URLs for secure downloads
- Composite deletion policies for security
- Write-once guard for compliance

**Production Metrics:**
- Upload latency: p50=45ms, p95=120ms
- Large file (10MB): p50=800ms, p95=2s
- Throughput: 1000+ req/sec sustained
- Error rate: <0.01%
- CPU utilization: ~25%

**Status:** ✅ Production deployment successful, service operational

