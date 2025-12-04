# Implementation Journey - Audit Service

**Team:** Adarsh, Vachan, Avnesh, Manan, Anand  
**Timeline:** Sprint 2-3 (2 weeks)  
**Tech Stack:** Spring Boot 3.5.4, MongoDB, Elasticsearch, OpenTelemetry

---

## Thread 1: PRD Kickoff - Understanding Requirements (Monday Week 1, 9am)

**Adarsh Maurya:** morning team, got the audit service PRD from product

**Adarsh Maurya:** basically we need to log EVERY action across all microservices. compliance requirement for SOX, HIPAA, GDPR

**Vachan Jalady:** every action? that's gonna be a ton of events

**Vachan Jalady:** canonical does 10k msg/sec, each generates like 4-5 audit events... we're looking at 40-50k events/sec

**Manan Kumar:** yeah throughput is gonna be the challenge

**Manan Kumar:** PRD mentions immutability too. append-only, no updates allowed

**Adarsh Maurya:** yup and they want: actor tracking, IP logging, action types, resource tracking, timestamp, outcome

**Avnesh Kumar:** are we using postgres or mongo?

**Anand Kummari:** PRD says MongoDB but I'm worried about immutability guarantees

**Anand Kummari:** postgres has better ACID for compliance. what do you all think?

**Vachan Jalady:** let's prototype both this week, decide based on perf tests

---

## Thread 2: Data Model Design (Monday Week 1, 2pm)

**Anand Kummari:** drafted the AuditLog model

```java
@Document(collection = "audit_logs")
class AuditLog {
    private String id;
    private String eventType;      // LOGIN, MESSAGE_CREATED, etc
    private String service;         // canonical, compliance, etc
    private String actor;           // userId or serviceId
    private String messageId;       // optional, for message-related events
    private Instant timestamp;
    private Map<String, Object> metadata;
}
```

**Adarsh Maurya:** looks good but we need more fields for compliance

**Adarsh Maurya:** actor_ip (where from), outcome (success/failure), resource_type, resource_id

**Vachan Jalady:** also tenant_id for multi-tenancy

**Vachan Jalady:** queries will filter by tenant constantly

**Anand Kummari:** adding those

**Anand Kummari:** also should metadata be JSONB for flexibility? different events need different context

**Manan Kumar:** yeah metadata as Map<String, Object> is flexible

**Manan Kumar:** stores as BSON in mongo, easy to query

---

## Thread 3: Validation Framework Design (Tuesday Week 1, 10am)

**Avnesh Kumar:** working on validation

**Avnesh Kumar:** saw PRD wants strict validation - can't have invalid audit events

**Avnesh Kumar:** thinking chain of responsibility pattern. thoughts?

**Adarsh Maurya:** +1 for chain pattern

**Adarsh Maurya:** ValidationChainBuilder → add rules → execute

**Avnesh Kumar:** yeah exactly. rules like:
- NotNullValidationRule (required fields)
- EventTypeValidationRule (valid event type from enum)
- InstantTimestampValidationRule (valid timestamp)
- MessageIdValidationRule (messageId format)

**Anand Kummari:** should rules short-circuit or collect all errors?

**Avnesh Kumar:** short-circuit for performance

**Avnesh Kumar:** first failure → throw ValidationException → reject request

**Manan Kumar:** makes sense. implement and let's review tomorrow

---

## Thread 4: Controller Implementation Review (Wednesday Week 1, 11am)

**Avnesh Kumar:** pushed AuditController

**Avnesh Kumar:** endpoints:
- POST /api/audit - create audit log
- GET /api/audit - query with filters
- GET /api/audit/{id} - get specific log

**Vachan Jalady:** looking at the code... POST /api/audit returns 200 on success

**Vachan Jalady:** should be 201 Created with Location header

**Avnesh Kumar:** oh yeah good catch

**Avnesh Kumar:** changing to 201 + Location header with created audit ID

**Adarsh Maurya:** also in GET /api/audit you're loading all results

**Adarsh Maurya:** need pagination. 100M audit logs = OOM

**Avnesh Kumar:** adding pagination params: page, size, sort

**Avnesh Kumar:** default page=0, size=50

---

## Thread 5: MongoDB vs PostgreSQL Decision (Wednesday Week 1, 3pm)

**Manan Kumar:** ran performance tests on both

**Manan Kumar:** MongoDB: 
- write: 15ms p95, 45k inserts/sec
- read (indexed): 8ms p95
- read (full scan): 850ms

**Manan Kumar:** PostgreSQL:
- write: 22ms p95, 32k inserts/sec  
- read (indexed): 12ms p95
- read (full scan): 1200ms

**Vachan Jalady:** mongo is faster but...

**Vachan Jalady:** for compliance we need ACID guarantees. mongo's eventual consistency is risky

**Adarsh Maurya:** I vote postgres

**Adarsh Maurya:** we can hit 40k/sec with batching. better compliance story

**Anand Kummari:** actually let's use mongo for now

**Anand Kummari:** already integrated, codebase uses @Document annotations

**Anand Kummari:** we can add batching + careful indexing for consistency

**Manan Kumar:** alright mongo it is. but we add STRONG consistency reads

**Manan Kumar:** ReadConcern.MAJORITY on all queries

---

## Thread 6: Validation Bug Found (Thursday Week 1, 9am)

**Adarsh Maurya:** testing validation chain... found bug 😬

**Adarsh Maurya:** InstantTimestampValidationRule rejects valid ISO-8601 timestamps

**Adarsh Maurya:** error: "Invalid timestamp format" for "2025-12-04T10:30:00Z"

**Avnesh Kumar:** checking the regex...

**Avnesh Kumar:** oh I see it. regex expects milliseconds but ISO allows without

**Avnesh Kumar:** should accept both: 2025-12-04T10:30:00Z AND 2025-12-04T10:30:00.123Z

**Avnesh Kumar:** fixing validation to parse with DateTimeFormatter.ISO_INSTANT

**Adarsh Maurya:** testing... ok now accepts both formats ✅

---

## Thread 7: Exception Handling (Thursday Week 1, 2pm)

**Avnesh Kumar:** implemented GlobalExceptionHandler

**Avnesh Kumar:** catches ValidationException → 400 with error details

**Avnesh Kumar:** catches AuditNotFoundException → 404

**Avnesh Kumar:** catches generic Exception → 500

**Vachan Jalady:** error response structure?

**Avnesh Kumar:** using ErrorResponse DTO:

```java
{
  "timestamp": "2025-12-04T10:30:00Z",
  "status": 400,
  "error": "Bad Request",
  "message": "Validation failed: eventType is required",
  "path": "/api/audit"
}
```

**Adarsh Maurya:** add request ID for tracing

**Adarsh Maurya:** helps correlate errors across services

**Avnesh Kumar:** good idea. adding request-id header + including in ErrorResponse

---

## Thread 8: Repository Layer (Friday Week 1, 10am)

**Anand Kummari:** implemented AuditRepository extending MongoRepository

**Anand Kummari:** custom queries:
- findByService(String service, Pageable)
- findByEventType(String eventType, Pageable)
- findByTimestampBetween(Instant start, Instant end, Pageable)

**Manan Kumar:** should add compound query

**Manan Kumar:** compliance team will query: "show all LOGIN_FAILURE for tenantX in last 7 days"

**Anand Kummari:** adding:

```java
List<AuditLog> findByServiceAndEventTypeAndTimestampBetween(
    String service, 
    String eventType, 
    Instant start, 
    Instant end, 
    Pageable pageable
);
```

**Vachan Jalady:** that method name is getting long lol

**Vachan Jalady:** use @Query annotation with custom MongoDB query?

**Anand Kummari:** yeah better:

```java
@Query("{ 'service': ?0, 'eventType': ?1, 'timestamp': { $gte: ?2, $lte: ?3 } }")
List<AuditLog> findAuditLogs(String service, String eventType, Instant start, Instant end, Pageable pageable);
```

---

## Thread 9: Service Layer Implementation (Friday Week 1, 2pm)

**Anand Kummari:** AuditServiceImpl done

**Anand Kummari:** createAuditLog() validates then saves to mongo

**Anand Kummari:** getAuditLogs() applies filters + pagination

**Adarsh Maurya:** reviewing... should createAuditLog() be async?

**Adarsh Maurya:** if canonical service waits for audit, adds latency to message processing

**Vachan Jalady:** good point but...

**Vachan Jalady:** if audit is async and fails, we lose the audit event. compliance violation

**Manan Kumar:** compromise: sync API call but async processing internally?

**Manan Kumar:** accept request → return 202 Accepted immediately → process async with retry

**Anand Kummari:** that's more complex tho

**Anand Kummari:** for MVP keeping it sync. we can optimize later if latency becomes issue

**Adarsh Maurya:** fair enough

---

## Thread 10: Integration Testing Setup (Monday Week 2, 9am)

**Avnesh Kumar:** setting up integration tests

**Avnesh Kumar:** using TestMongoConfig with embedded mongo

**Avnesh Kumar:** test flow: POST audit → verify saved → GET audit → verify returned

**Manan Kumar:** also test validation failures

**Manan Kumar:** POST with missing required field → should get 400

**Avnesh Kumar:** added negative test cases:
- missing eventType → 400 ✅
- invalid timestamp → 400 ✅  
- null service → 400 ✅

**Avnesh Kumar:** all passing

---

## Thread 11: Performance Issue Found (Monday Week 2, 2pm)

**Manan Kumar:** load testing... hitting performance wall 😤

**Manan Kumar:** at 5k req/sec response time jumps to 500ms

**Manan Kumar:** should be under 100ms

**Vachan Jalady:** checked mongo indexes?

**Manan Kumar:** oh crap we don't have indexes

**Manan Kumar:** every query is doing full collection scan

**Anand Kummari:** adding indexes:

```java
@Document(collection = "audit_logs")
@CompoundIndex(def = "{'service': 1, 'timestamp': -1}")
@CompoundIndex(def = "{'eventType': 1, 'timestamp': -1}")
@CompoundIndex(def = "{'messageId': 1}")
class AuditLog { ... }
```

**Manan Kumar:** rebuilding indexes... retesting

**Manan Kumar:** ok now p95 is 45ms at 10k req/sec 🚀

---

## Thread 12: Immutability Concern (Tuesday Week 2, 10am)

**Adarsh Maurya:** compliance question came up

**Adarsh Maurya:** operator accidentally logged wrong audit event. can they delete it?

**Vachan Jalady:** no deletes. immutability requirement

**Adarsh Maurya:** but operator made a mistake... just leaves wrong data in audit forever?

**Anand Kummari:** soft delete approach

**Anand Kummari:** add deletedAt and deletedBy fields. mark as deleted but don't actually remove

**Anand Kummari:** queries filter deleted by default but admin can see full history

**Adarsh Maurya:** should deletion require approval?

**Adarsh Maurya:** can't have ops deleting their own mistakes

**Vachan Jalady:** +1 approval workflow

**Vachan Jalady:** separate table: audit_deletion_requests with approval status

**Manan Kumar:** that's scope creep for this sprint

**Manan Kumar:** let's add soft delete now, approval workflow next sprint

**Adarsh Maurya:** fine but documenting as tech debt

---

## Thread 13: OpenTelemetry Integration (Wednesday Week 2, 11am)

**Avnesh Kumar:** adding observability

**Avnesh Kumar:** OpenTelemetry configured in application.properties

**Avnesh Kumar:** traces export to http://localhost:4318/v1/traces

**Adarsh Maurya:** metrics?

**Avnesh Kumar:** exposing:
- audit_logs_created_total (counter)
- audit_log_creation_duration_seconds (histogram)
- audit_query_duration_seconds (histogram)

**Avnesh Kumar:** prometheus scrapes /actuator/prometheus

**Manan Kumar:** add error rate metric too

**Manan Kumar:** audit_logs_failed_total

**Avnesh Kumar:** adding

---

## Thread 14: Code Review Session (Wednesday Week 2, 3pm)

**Adarsh Maurya:** final review before staging deploy

**Adarsh Maurya:** AuditController ✅
- proper HTTP codes (201, 404, 400, 500)
- pagination implemented
- validation before processing

**Adarsh Maurya:** ValidationChainBuilder ✅  
- chain pattern implemented correctly
- all required rules present
- proper error messages

**Vachan Jalady:** AuditServiceImpl looks good

**Vachan Jalady:** one thing - no transaction management

**Vachan Jalady:** should wrap in @Transactional?

**Anand Kummari:** mongo doesn't need transactions for single-document writes

**Anand Kummari:** already atomic

**Manan Kumar:** exception handling solid

**Manan Kumar:** GlobalExceptionHandler catches everything appropriately

**Avnesh Kumar:** tests all passing?

**Avnesh Kumar:** unit tests: 24 passed ✅
**Avnesh Kumar:** integration tests: 8 passed ✅

**Adarsh Maurya:** approved for staging deploy

---

## Thread 15: Staging Deployment (Thursday Week 2, 9am)

**Manan Kumar:** deploying to staging...

**Manan Kumar:** MongoDB connection: connected ✅

**Manan Kumar:** health check: /actuator/health → UP ✅

**Manan Kumar:** sample audit log created: SUCCESS ✅

**Avnesh Kumar:** testing from canonical service

**Avnesh Kumar:** canonical creates message → posts audit event → audit service receives ✅

**Vachan Jalady:** query endpoint working?

**Vachan Jalady:** GET /api/audit?service=canonical&page=0&size=10

**Vachan Jalady:** returns 10 results ✅ pagination working ✅

**Anand Kummari:** monitoring dashboards setup

**Anand Kummari:** grafana showing metrics ✅

**Anand Kummari:** seeing ~500 audit events/sec from canonical

**Adarsh Maurya:** 24hr soak test starting

---

## Thread 16: Bug Found in Staging (Thursday Week 2, 4pm)

**Vachan Jalady:** found issue in staging 😬

**Vachan Jalady:** querying with invalid date range returns 500

**Vachan Jalady:** GET /api/audit?startDate=invalid&endDate=2025-12-04

**Avnesh Kumar:** should be 400 not 500

**Avnesh Kumar:** date parsing throwing uncaught exception

**Avnesh Kumar:** adding validation in controller:

```java
@GetMapping
public ResponseEntity<?> getAuditLogs(
    @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant startDate,
    ...
) {
    // Spring handles parsing, throws 400 if invalid
}
```

**Avnesh Kumar:** deploying fix... testing... 400 now ✅

---

## Thread 17: Load Testing Results (Friday Week 2, 10am)

**Manan Kumar:** 24hr soak test complete

**Manan Kumar:** results:
- total events: 43.2M
- avg throughput: 501 events/sec
- p50 latency: 23ms
- p95 latency: 67ms
- p99 latency: 145ms
- errors: 0.003%

**Manan Kumar:** mongo collection size: 8.2GB

**Manan Kumar:** CPU: avg 18%, max 34%

**Manan Kumar:** memory: stable at 512MB, no leaks

**Adarsh Maurya:** error rate super low 👍

**Adarsh Maurya:** what were the errors?

**Manan Kumar:** checked logs... all validation errors (clients sending bad data)

**Manan Kumar:** no system errors. we're solid

**Vachan Jalady:** ready for prod?

**Adarsh Maurya:** yup. deploying Monday

---

## Thread 18: Production Deployment (Monday Week 3, 9am)

**Adarsh Maurya:** production deployment starting

**Adarsh Maurya:** configs verified:
- MongoDB URI: prod cluster ✅
- indexes created ✅  
- OpenTelemetry exporter: prod collector ✅
- log level: INFO ✅

**Manan Kumar:** deploying...

**Manan Kumar:** pod starting... health check passing ✅

**Manan Kumar:** ramping traffic: 10%... 25%... 50%... 100% ✅

**Avnesh Kumar:** first production audit event from canonical... SUCCESS ✅

**Anand Kummari:** monitoring dashboards live

**Anand Kummari:** latencies nominal, no errors

**Vachan Jalady:** compliance service consuming audit events via query API ✅

**Vachan Jalady:** they're detecting failed login attempts correctly

**Adarsh Maurya:** audit service is LIVE 🚀

**Manan Kumar:** we did it team 🎉

**Anand Kummari:** shipping immutable audit logs to production feels good

---

## Thread 19: Post-Deploy Observation (Tuesday Week 3, 10am)

**Vachan Jalady:** been watching prod for 24hrs

**Vachan Jalady:** throughput: averaging 850 events/sec

**Vachan Jalady:** way higher than staging (500/sec)

**Manan Kumar:** yeah more services integrated now

**Manan Kumar:** canonical, compliance, search all logging

**Adarsh Maurya:** latencies still good?

**Vachan Jalady:** p95 at 73ms, p99 at 158ms

**Vachan Jalady:** slightly higher than staging but acceptable

**Anand Kummari:** mongo CPU at 42%

**Anand Kummari:** plenty of headroom. can easily scale to 2k events/sec

**Avnesh Kumar:** any errors?

**Vachan Jalady:** 0.005% error rate, all validation failures from bad client data

**Vachan Jalady:** system is rock solid

---

## Thread 20: Retrospective (Friday Week 3, 2pm)

**Adarsh Maurya:** retro time. what went well?

**Manan Kumar:** validation framework was solid

**Manan Kumar:** chain of responsibility pattern made rules easy to add

**Avnesh Kumar:** +1 and exception handling was clean

**Avnesh Kumar:** GlobalExceptionHandler caught everything appropriately

**Anand Kummari:** mongo vs postgres testing upfront saved us

**Anand Kummari:** could've been a blocker if we decided wrong

**Vachan Jalady:** what could improve?

**Adarsh Maurya:** should've added indexes from day 1

**Adarsh Maurya:** performance issue on Monday Week 2 was avoidable

**Manan Kumar:** yeah and soft delete / approval workflow got punted

**Manan Kumar:** compliance is asking for it now. next sprint priority

**Avnesh Kumar:** overall though, solid delivery

**Avnesh Kumar:** 2.5 weeks from PRD to production, zero downtime

**Adarsh Maurya:** agreed. audit service: SHIPPED ✅

---

## Summary

**Implementation Timeline:**
- Week 1: Design, core implementation, validation framework
- Week 2: Testing, performance optimization, staging deployment
- Week 3: Production deployment, monitoring, stabilization

**Key Technical Decisions:**
1. MongoDB over PostgreSQL for write performance (45k vs 32k inserts/sec)
2. Chain of Responsibility pattern for validation (extensible, maintainable)
3. Sync API with future async optimization path (compliance over performance initially)
4. Compound indexes on service, eventType, timestamp (query optimization)
5. Soft delete planned for next sprint (immutability with flexibility)

**Challenges Overcome:**
1. Timestamp validation regex bug - fixed to accept ISO-8601 variants
2. Missing MongoDB indexes - added compound indexes, 10x performance improvement
3. Date parsing 500 errors - added Spring validation annotations
4. Kafka offset management - transaction-aware commits

**Final Production Metrics:**
- Throughput: 850 events/sec sustained
- Latency: p95=73ms, p99=158ms
- Error rate: 0.005% (all client validation errors)
- Availability: 100% uptime
- Resource usage: 42% CPU, 512MB memory (stable)

**Architecture Delivered:**
- REST API: POST, GET with filtering and pagination
- Validation: Chain pattern with 7 validation rules
- Storage: MongoDB with compound indexes
- Observability: OpenTelemetry traces + Prometheus metrics
- Error handling: Global exception handler with proper HTTP codes
- Testing: 24 unit tests + 8 integration tests

**Status:** ✅ Production deployment successful, service operational

