# Implementation Journey - Canonical Service

**Team:** Adarsh, Vachan, Avnesh, Manan, Anand  
**Timeline:** Sprint 1-2 (3 weeks)  
**Tech Stack:** Spring Boot 3.5.4, MongoDB, Kafka, Elasticsearch, OpenTelemetry

---

## Thread 1: PRD Review - The Front Door (Monday Week 1, 9am)

**Manan Kumar:** alright team, just got the PRD for canonical service

**Manan Kumar:** this is basically the front door for everything. ingestion, validation, normalization, retention

**Manan Kumar:** target throughput is 10k msg/sec

**Adarsh Maurya:** 10k/sec is no joke 😬

**Adarsh Maurya:** what message types are we supporting? email and slack right?

**Vachan Jalady:** PRD mentions email and slack initially, but architecture should be extensible

**Vachan Jalady:** more channels coming later (teams, whatsapp, etc)

**Manan Kumar:** yup so we need validator registry pattern. plug in new validators without code changes

**Avnesh Kumar:** schema validation too right? saw email-schema.json and slack-schema.json mentioned

**Manan Kumar:** yeah JSON schema validation first, then business rules

**Anand Kummari:** what about the data pipeline? 

**Anand Kummari:** ingest → validate → normalize → store mongo → send to raw storage → kafka publish?

**Manan Kumar:** exactly. and retention scheduler for compliance

**Vachan Jalady:** k so packages: ingestionAndValidation, normalizer, retention

**Vachan Jalady:** I can take ingestion controllers + validation

**Avnesh Kumar:** I'll grab normalizer + kafka integration

**Anand Kummari:** retention is mine. scheduled jobs are fun

**Manan Kumar:** me and @Adarsh will do the core models, mongo setup, exception handling

---

## Thread 2: Package Structure Discussion (Monday Week 1, 2pm)

**Vachan Jalady:** laying out ingestionAndValidation package

**Vachan Jalady:** thinking: controllers, models, services, validation, repository, utils

**Adarsh Maurya:** models - do we have BaseMessageDTO that email and slack extend?

**Vachan Jalady:** yup BaseMessageDTO with common fields (id, tenantId, timestamp, type)

**Vachan Jalady:** then EmailDTO and SlackDTO with specific fields

**Manan Kumar:** what about ProcessedMessage?

**Vachan Jalady:** that's the internal model after validation/normalization

**Vachan Jalady:** BaseMessageDTO = incoming, ProcessedMessage = outgoing

**Avnesh Kumar:** validation package structure?

**Vachan Jalady:** AbstractJsonSchemaValidator as base

**Vachan Jalady:** MessageValidator interface, ValidatorRegistry to pick validators

**Vachan Jalady:** schemaValidators subpackage with EmailValidator, SlackValidator

**Anand Kummari:** +1 clean separation

---

## Thread 3: MongoDB Schema Design (Tuesday Week 1, 10am)

**Manan Kumar:** working on mongo document structure

**Manan Kumar:** question: should we store raw payload AND normalized in same doc?

**Adarsh Maurya:** what's the size difference?

**Manan Kumar:** raw email ~5kb, normalized ~3kb = 8kb total per message

**Manan Kumar:** at 10k msg/sec that's 80MB/sec into mongo

**Avnesh Kumar:** can we just store normalized + reference to S3 for raw?

**Avnesh Kumar:** like: {normalized: {...}, rawStorageRef: {bucket, key}}

**Vachan Jalady:** that's actually smart

**Vachan Jalady:** saves 50% mongo storage, raw storage service handles archival

**Manan Kumar:** but data consistency... what if mongo succeeds but S3 fails?

**Adarsh Maurya:** make mongo the source of truth

**Adarsh Maurya:** persist normalized to mongo first (sync), then async send to raw storage + kafka

**Adarsh Maurya:** if async fails, recovery job retries later

**Manan Kumar:** k implementing that pattern

---

## Thread 4: Validator Registry Implementation (Wednesday Week 1, 11am)

**Vachan Jalady:** built ValidatorRegistry

```java
@Component
public class ValidatorRegistry {
    private final Map<String, MessageValidator> validators;
    
    public MessageValidator getValidator(String messageType) {
        return validators.get(messageType);
    }
}
```

**Vachan Jalady:** auto-wires all MessageValidator beans, maps by message type

**Adarsh Maurya:** how does it know which validator for which type?

**Vachan Jalady:** each validator has @Component("EMAIL") or @Component("SLACK")

**Vachan Jalady:** registry uses bean name as key

**Avnesh Kumar:** what if no validator found for type?

**Vachan Jalady:** throws ValidationException with clear message

**Vachan Jalady:** "No validator registered for message type: TEAMS"

**Manan Kumar:** nice. extensible without code changes

---

## Thread 5: JSON Schema Validation (Thursday Week 1, 9am)

**Vachan Jalady:** implementing AbstractJsonSchemaValidator

**Vachan Jalady:** loads schema from resources/schemas/, validates incoming JSON

**Vachan Jalady:** but hitting issue... schema validation passes but business rules still need checking

**Adarsh Maurya:** what business rules?

**Vachan Jalady:** like for email: from can't equal to, subject max 500 chars, body not empty

**Vachan Jalady:** schema validates structure, not business logic

**Manan Kumar:** two-phase validation then

**Manan Kumar:** phase 1: JSON schema (structure), phase 2: business rules (logic)

**Vachan Jalady:** exactly. AbstractJsonSchemaValidator does phase 1

**Vachan Jalady:** EmailValidator/SlackValidator extend it, add phase 2

**Anand Kummari:** what about error messages?

**Vachan Jalady:** throwing ValidationException with detailed message

**Vachan Jalady:** "Validation failed: from field is required and must be valid email format"

---

## Thread 6: Duplicate Detection Bug (Friday Week 1, 2pm)

**Manan Kumar:** added DuplicateCheckService

**Manan Kumar:** checks if messageId already exists before processing

**Manan Kumar:** but found bug... same message being accepted twice 😬

**Avnesh Kumar:** race condition?

**Manan Kumar:** yeah two requests come simultaneously, both check db at same time

**Manan Kumar:** both see "not exists", both insert

**Vachan Jalady:** unique index on messageId in mongo?

**Manan Kumar:** added but mongo throws duplicate key exception

**Manan Kumar:** need to catch and return 409 Conflict instead of 500

**Adarsh Maurya:** also check IngestionUniqueIdRepository

**Adarsh Maurya:** might need @Transactional for read-then-write

**Manan Kumar:** mongo doesn't support transactions in our version

**Manan Kumar:** using unique index + exception handling instead

**Manan Kumar:** catch DuplicateKeyException → return 409 with existing messageId

**Manan Kumar:** tested with concurrent requests... working now ✅

---

## Thread 7: Normalizer Service Design (Monday Week 2, 9am)

**Avnesh Kumar:** starting normalizer package

**Avnesh Kumar:** flow: get validated message → normalize (lowercase, trim, etc) → store mongo → send to raw storage → kafka

**Adarsh Maurya:** what normalization rules?

**Avnesh Kumar:** for email:
- lowercase from/to addresses
- trim whitespace from subject/body
- standardize date format
- extract domain from addresses

**Avnesh Kumar:** for slack:
- normalize user IDs
- extract channel info
- preserve emoji (unlike my first idea to remove them lol)

**Vachan Jalady:** should we preserve original too?

**Avnesh Kumar:** original goes to RawStorageService

**Avnesh Kumar:** we only store normalized in mongo for processing

**Manan Kumar:** make sure normalization is idempotent

**Manan Kumar:** normalize(normalize(msg)) == normalize(msg)

**Avnesh Kumar:** yup using pure functions, no side effects

---

## Thread 8: Kafka Integration Issues (Tuesday Week 2, 10am)

**Avnesh Kumar:** integrated kafka producer... having issues 😤

**Avnesh Kumar:** messages publishing to broker but consumers not picking up

**Manan Kumar:** partition key set?

**Avnesh Kumar:** oh... no

**Avnesh Kumar:** just doing kafkaTemplate.send(topic, message)

**Manan Kumar:** need partition key for ordering within tenant

**Manan Kumar:** send(topic, tenantId, message) so all msgs from same tenant → same partition

**Avnesh Kumar:** trying... ok consumers picking up now ✅

**Avnesh Kumar:** also added in application.properties:

```properties
spring.kafka.producer.key-serializer=org.apache.kafka.common.serialization.StringSerializer
spring.kafka.producer.value-serializer=org.springframework.kafka.support.serializer.JsonSerializer
spring.kafka.producer.acks=-1
spring.kafka.producer.retries=3
```

**Adarsh Maurya:** acks=-1 good for durability

**Adarsh Maurya:** also add idempotence.enable=true to prevent dupes on retry

**Avnesh Kumar:** added 👍

---

## Thread 9: Elasticsearch Integration (Wednesday Week 2, 11am)

**Avnesh Kumar:** adding elasticsearch for normalized message indexing

**Avnesh Kumar:** using ElasticConfig to setup RestHighLevelClient

**Avnesh Kumar:** index pattern: messages-{YYYY-MM-DD} for daily indices

**Vachan Jalady:** why daily indices?

**Avnesh Kumar:** retention management

**Avnesh Kumar:** when messages expire, just delete old index instead of querying + deleting docs

**Manan Kumar:** smart. what's the mapping?

**Avnesh Kumar:** multi-field for from/to/subject

**Avnesh Kumar:** text field for full-text search, keyword for exact match

**Avnesh Kumar:** like: from (text) + from.keyword (keyword)

**Adarsh Maurya:** index writes sync or async?

**Avnesh Kumar:** async

**Avnesh Kumar:** don't want ES slowness blocking message processing

**Avnesh Kumar:** if ES down, messages still process, we rebuild index later

---

## Thread 10: Retention Policy Model (Thursday Week 2, 9am)

**Anand Kummari:** working on retention package

**Anand Kummari:** model: RetentionPolicy with tenantId, retentionDays, status

**Anand Kummari:** but question... should policies be per-tenant or per-message-type?

**Manan Kumar:** PRD says per-tenant

**Manan Kumar:** but some tenants might want different retention for different msg types

**Manan Kumar:** like: emails 7 years, slack 30 days

**Anand Kummari:** adding messageType to policy then

**Anand Kummari:** composite key: (tenantId, messageType) → retentionDays

**Vachan Jalady:** what if no policy found for tenant+type?

**Anand Kummari:** default policy: 7 years (conservative for compliance)

**Adarsh Maurya:** also add status field to messages

**Adarsh Maurya:** ACTIVE, HELD, EXPIRED, DELETED for legal holds

**Anand Kummari:** good call. adding to ProcessedMessage model

---

## Thread 11: Retention Scheduler Implementation (Friday Week 2, 10am)

**Anand Kummari:** retention scheduler done

**Anand Kummari:** @Scheduled cron: 0 0 0 * * * (midnight daily)

**Anand Kummari:** finds messages where createdAt + retentionDays < now AND status != HELD

**Anand Kummari:** deletes from mongo + elasticsearch

**Vachan Jalady:** how many messages deleted per run?

**Anand Kummari:** batching 1000 at a time to avoid memory issues

**Vachan Jalady:** what about audit logging?

**Anand Kummari:** oh crap forgot that

**Anand Kummari:** adding AuditLoggingAspect call for each deletion

**Anand Kummari:** audit event: {action: RETENTION_DELETE, messageId, tenantId, reason: TTL_EXPIRED}

**Manan Kumar:** should audit call be sync or async?

**Avnesh Kumar:** sync IMO

**Avnesh Kumar:** if audit fails, deletion should fail. compliance requirement

**Anand Kummari:** adding with @Retryable for resilience

---

## Thread 12: Audit Service Integration (Monday Week 3, 9am)

**Adarsh Maurya:** implementing AuditLoggingAspect

**Adarsh Maurya:** using @Around advice on controller methods

**Adarsh Maurya:** logs: request received, validation success/failure, storage success/failure

**Manan Kumar:** using Feign client for audit service calls?

**Adarsh Maurya:** yeah AuditClient with @FeignClient

**Adarsh Maurya:** POST /api/audit with AuditLogRequest DTO

**Vachan Jalady:** what if audit service is down?

**Adarsh Maurya:** circuit breaker with fallback

**Adarsh Maurya:** log to local file as backup, async job replays to audit later

**Avnesh Kumar:** circuit breaker config?

**Adarsh Maurya:** using Resilience4j

**Adarsh Maurya:** failure threshold: 5, wait duration: 60s, half-open after: 30s

---

## Thread 13: Exception Handling Review (Tuesday Week 3, 10am)

**Manan Kumar:** reviewing GlobalExceptionHandler

**Manan Kumar:** covering ValidationException → 400, DuplicateMessageException → 409

**Manan Kumar:** but what about nested exceptions?

**Adarsh Maurya:** like what?

**Manan Kumar:** ValidationException wrapping NormalizationException

**Manan Kumar:** should we unwrap and show root cause?

**Vachan Jalady:** nah keep it simple

**Vachan Jalady:** log full stack internally, return high-level error to client

**Vachan Jalady:** client doesn't need to know internal implementation details

**Adarsh Maurya:** +1 

**Adarsh Maurya:** also adding request-id to all error responses

**Adarsh Maurya:** helps with debugging across services

---

## Thread 14: Load Testing (Wednesday Week 3, 11am)

**Manan Kumar:** running jmeter load test

**Manan Kumar:** 5000 req/sec for 10 minutes

**Manan Kumar:** results: p50=35ms, p95=120ms, p99=350ms

**Adarsh Maurya:** CPU usage?

**Manan Kumar:** averaging 45%, spikes to 65%

**Manan Kumar:** mongo at 40% CPU, kafka producer at 10%

**Vachan Jalady:** error rate?

**Manan Kumar:** 0.2% - all validation failures (bad test data)

**Manan Kumar:** zero system errors

**Avnesh Kumar:** can we hit 10k req/sec?

**Manan Kumar:** ramping to 10k... ok holding steady

**Manan Kumar:** p50=45ms, p95=180ms, p99=600ms

**Manan Kumar:** CPU at 75%, memory stable

**Manan Kumar:** we're good for target throughput 🚀

---

## Thread 15: Code Review Session (Thursday Week 3, 9am)

**Adarsh Maurya:** final review before staging deploy

**Adarsh Maurya:** ingestionAndValidation package ✅
- MessageController with proper REST endpoints
- ValidatorRegistry with extensible pattern
- AbstractJsonSchemaValidator + concrete validators
- DuplicateCheckService with race condition handling

**Vachan Jalady:** normalizer package ✅
- NormalizationService with idempotent transforms
- ElasticConfig for search indexing
- Kafka producer with proper config
- RawStorageClient with async upload

**Anand Kummari:** retention package ✅
- RetentionScheduler with cron job
- Legal hold support (status field)
- Batch deletion for performance
- Audit integration for compliance

**Manan Kumar:** exception handling ✅
- GlobalExceptionHandler with all cases covered
- Proper HTTP status codes
- Request IDs for tracing

**Avnesh Kumar:** all unit tests passing?

**Vachan Jalady:** 47 tests, all green ✅

**Adarsh Maurya:** approved for staging

---

## Thread 16: Staging Deployment (Thursday Week 3, 2pm)

**Manan Kumar:** deploying to staging...

**Manan Kumar:** MongoDB: connected ✅

**Manan Kumar:** Kafka: broker connection successful ✅

**Manan Kumar:** Elasticsearch: cluster health GREEN ✅

**Manan Kumar:** health check: /actuator/health → UP ✅

**Avnesh Kumar:** testing ingest flow

**Avnesh Kumar:** POST /api/messages with email payload

**Avnesh Kumar:** response 201 Created with messageId ✅

**Avnesh Kumar:** checking mongo... document stored ✅

**Avnesh Kumar:** checking kafka... event published ✅

**Avnesh Kumar:** checking elasticsearch... indexed ✅

**Vachan Jalady:** testing validation

**Vachan Jalady:** POST with invalid email (missing from field)

**Vachan Jalady:** 400 Bad Request with clear error message ✅

**Anand Kummari:** testing duplicate detection

**Anand Kummari:** POST same messageId twice

**Anand Kummari:** first: 201, second: 409 Conflict ✅

**Adarsh Maurya:** staging looking solid

**Adarsh Maurya:** 48hr soak test starting

---

## Thread 17: Bug in Staging (Friday Week 3, 10am)

**Vachan Jalady:** found issue in staging 😬

**Vachan Jalady:** slack messages failing validation with "invalid schema"

**Vachan Jalady:** but email messages work fine

**Avnesh Kumar:** checking slack-schema.json...

**Avnesh Kumar:** schema looks correct

**Avnesh Kumar:** wait... SlackValidator loading wrong schema file

**Avnesh Kumar:** it's loading email-schema.json instead of slack-schema.json

**Vachan Jalady:** copy-paste error?

**Avnesh Kumar:** yeah 🤦

**Avnesh Kumar:** fixing:

```java
// Before
private static final String SCHEMA_PATH = "/schemas/email-schema.json";

// After  
private static final String SCHEMA_PATH = "/schemas/slack-schema.json";
```

**Avnesh Kumar:** deploying fix... testing... slack validation working now ✅

---

## Thread 18: OpenTelemetry Configuration (Monday Week 4, 9am)

**Adarsh Maurya:** adding observability

**Adarsh Maurya:** OpenTelemetry configured in application.properties

**Adarsh Maurya:** exporting traces to http://localhost:4318/v1/traces

**Manan Kumar:** sampling strategy?

**Adarsh Maurya:** 10% head sampling for normal traffic

**Adarsh Maurya:** 100% for errors and requests >1s

**Adarsh Maurya:** otel.traces.sampler=parentbased_traceidratio, sampler.arg=0.1

**Avnesh Kumar:** custom spans?

**Adarsh Maurya:** adding spans around:
- validation (validate-message)
- normalization (normalize-message)  
- mongo save (store-message)
- kafka publish (publish-event)

**Adarsh Maurya:** also baggage with tenantId and messageId for correlation

**Vachan Jalady:** metrics?

**Adarsh Maurya:** prometheus at /actuator/prometheus

**Adarsh Maurya:** counters: messages_received, messages_validated, messages_stored

**Adarsh Maurya:** histograms: validation_duration, normalization_duration

---

## Thread 19: Production Deployment (Tuesday Week 4, 9am)

**Adarsh Maurya:** 48hr soak test complete

**Adarsh Maurya:** results:
- total messages: 4.2M  
- avg throughput: 486/sec
- p95 latency: 145ms
- errors: 0.08% (all validation failures)
- CPU: stable 35-50%
- memory: no leaks

**Manan Kumar:** ready for prod

**Manan Kumar:** double-checking configs:
- MongoDB URI: prod cluster ✅
- Kafka bootstrap: prod brokers ✅
- Elasticsearch hosts: prod cluster ✅  
- Audit service URL: prod endpoint ✅

**Vachan Jalady:** deploying to prod...

**Vachan Jalady:** health check passing ✅

**Vachan Jalady:** traffic ramping: 10%... 25%... 50%... 100% ✅

**Avnesh Kumar:** first production message... SUCCESS ✅

**Avnesh Kumar:** mongo stored ✅, kafka published ✅, elasticsearch indexed ✅

**Anand Kummari:** monitoring dashboards live

**Anand Kummari:** latencies nominal, throughput ramping up

**Adarsh Maurya:** canonical service is LIVE 🚀

**Manan Kumar:** THE FRONT DOOR IS OPEN 🎉

---

## Thread 20: Post-Deploy Monitoring (Wednesday Week 4, 10am)

**Vachan Jalady:** monitoring prod for 24hrs

**Vachan Jalady:** throughput: 1200 msg/sec sustained (higher than expected!)

**Vachan Jalady:** p95 latency: 168ms, p99: 420ms

**Manan Kumar:** that's within SLA (500ms)

**Adarsh Maurya:** error rate?

**Vachan Jalady:** 0.05% - all client validation errors

**Vachan Jalady:** zero system errors, zero kafka failures, zero mongo timeouts

**Avnesh Kumar:** retention job ran last night

**Avnesh Kumar:** deleted 15k expired messages successfully

**Avnesh Kumar:** all audit events logged correctly

**Anand Kummari:** elasticsearch index size growing as expected

**Anand Kummari:** daily indices rotating properly

**Manan Kumar:** canonical service: stable and operational ✅

---

## Thread 21: Retrospective (Friday Week 4, 2pm)

**Adarsh Maurya:** retro time. what went well?

**Vachan Jalady:** validator registry pattern was clutch

**Vachan Jalady:** made email and slack validation super clean, easy to add new types

**Avnesh Kumar:** +1 and kafka integration was smoother than expected

**Avnesh Kumar:** acks=-1 config gave us durability without perf hit

**Anand Kummari:** retention scheduler worked first try

**Anand Kummari:** legal hold status field was good foresight

**Manan Kumar:** what could improve?

**Adarsh Maurya:** should've added unique index on messageId from day 1

**Adarsh Maurya:** race condition bug was avoidable

**Vachan Jalady:** and the copy-paste error in SlackValidator lol

**Vachan Jalady:** need better code review checklist

**Manan Kumar:** load testing earlier would've been good

**Manan Kumar:** found mongo CPU issue late in week 3

**Avnesh Kumar:** overall tho... shipped in 4 weeks from PRD to prod

**Avnesh Kumar:** zero prod incidents, handling 1200 msg/sec

**Adarsh Maurya:** canonical service: DELIVERED ✅

---

## Summary

**Implementation Timeline:**
- Week 1: Design, core models, validation framework, mongo setup
- Week 2: Normalizer, kafka integration, elasticsearch indexing
- Week 3: Retention scheduler, audit integration, exception handling, load testing
- Week 4: OpenTelemetry, staging validation, production deployment, monitoring

**Key Technical Decisions:**
1. ValidatorRegistry pattern for extensible message type support
2. Two-phase validation: JSON schema + business rules
3. MongoDB stores normalized data, S3 stores raw (50% space savings)
4. Kafka partitioning by tenantId for ordering
5. Elasticsearch daily indices for easy retention management
6. Legal hold status field: ACTIVE, HELD, EXPIRED, DELETED
7. Sync audit logging with circuit breaker for compliance
8. OpenTelemetry 10% sampling for observability

**Challenges Overcome:**
1. Race condition in duplicate detection - solved with unique index + exception handling
2. Kafka consumers not picking up - fixed with partition key
3. SlackValidator schema loading bug - copy-paste error caught in staging
4. MongoDB CPU usage - optimized with separate raw storage
5. Audit service failure handling - added circuit breaker + local fallback

**Final Production Metrics:**
- Throughput: 1200 msg/sec sustained (20% above target)
- Latency: p95=168ms, p99=420ms (within 500ms SLA)
- Error rate: 0.05% (all client validation errors)
- Availability: 100% uptime post-deployment
- Resource usage: 35-50% CPU, memory stable

**Architecture Delivered:**
- REST API: POST /api/messages with validation + deduplication
- Validation: Extensible registry with JSON schema + business rules
- Storage: MongoDB (normalized) + RawStorageService (raw)
- Search: Elasticsearch with daily indices
- Events: Kafka producer with acks=-1 + idempotence
- Retention: Scheduled job with legal hold support
- Audit: Integration with circuit breaker
- Observability: OpenTelemetry traces + Prometheus metrics

**Status:** ✅ Production deployment successful, service operational at 1200 msg/sec

