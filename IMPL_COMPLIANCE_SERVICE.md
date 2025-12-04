# Implementation Journey - Compliance Service

**Team:** Adarsh, Vachan, Avnesh, Manan, Anand  
**Timeline:** Sprint 3-4 (3 weeks)  
**Tech Stack:** Spring Boot 3.5.4, PostgreSQL, Kafka, MongoDB, Elasticsearch, SNS

---

## Thread 1: PRD Review - The Policy Engine (Monday Week 1, 9am)

**Adarsh Maurya:** morning team, got the compliance service PRD

**Adarsh Maurya:** we're building the policy evaluation engine. detects violations in messages, generates alerts, manages policies

**Manan Kumar:** what kind of policies are we supporting?

**Adarsh Maurya:** PRD mentions two types: regex-based (pattern matching) and keyword-based (word lists)

**Adarsh Maurya:** also threshold policies like "10+ emails from same sender in 5 minutes"

**Vachan Jalady:** regex policies are scary

**Vachan Jalady:** someone writes `/^(a+)+b$/` and we hang for 30 seconds. ReDoS vulnerability

**Avnesh Kumar:** we need complexity scoring upfront

**Avnesh Kumar:** reject patterns with nested quantifiers, high backtracking potential

**Manan Kumar:** also timeout during evaluation. 50ms max per policy check

**Anand Kummari:** what's the throughput target?

**Adarsh Maurya:** 10k msg/sec from canonical service

**Adarsh Maurya:** with 500 policies loaded, that's 5M policy evaluations/sec

**Vachan Jalady:** 5M/sec 😱 that's... aggressive

**Manan Kumar:** we'll need in-memory policy cache, compiled regex patterns, parallel evaluation

**Avnesh Kumar:** I can take policy evaluation engine + regex safety

**Anand Kummari:** I'll grab notification service + SNS integration

**Vachan Jalady:** me and @Manan can handle policy management + kafka consumer

---

## Thread 2: Entity Design Discussion (Monday Week 1, 2pm)

**Vachan Jalady:** working on entity models

**Vachan Jalady:** got Policy as abstract base class, RegexPolicy and KeywordPolicy extend it

**Adarsh Maurya:** what fields on base Policy?

**Vachan Jalady:** id, name, description, severity (CRITICAL/HIGH/MEDIUM/LOW), enabled status

**Vachan Jalady:** also policyConditions list - that's the actual matching logic

**Manan Kumar:** PolicyCondition structure?

**Vachan Jalady:** field (what to check), operator (CONTAINS, MATCHES, EQUALS), value (pattern or keyword)

**Vachan Jalady:** flexible enough for different policy types

**Anand Kummari:** what about actions?

**Anand Kummari:** when policy hits, what happens? quarantine? delete? just alert?

**Vachan Jalady:** adding action enum: ALERT, QUARANTINE, DELETE, FORWARD

**Vachan Jalady:** default is ALERT, but tenant can configure per policy

**Manan Kumar:** also need Flag entity for tracking hits

**Manan Kumar:** when policy triggers, create Flag record with messageId, policyId, timestamp

---

## Thread 3: Chain of Responsibility Pattern (Tuesday Week 1, 10am)

**Avnesh Kumar:** implementing policy evaluation with chain of responsibility

**Avnesh Kumar:** each PolicyHandler checks if it can handle the policy type, then evaluates

**Adarsh Maurya:** so like: AbstractPolicyHandler → RegexHandler → KeywordHandler?

**Avnesh Kumar:** exactly. ChainConfiguration builds the chain:

```java
@Bean
public PolicyHandler chainOfPolicyHandlers(
    KeywordHandler keywordHandler,
    EvaluatorAdapterHandler evaluatorAdapterHandler
) {
    keywordHandler.setNext(evaluatorAdapterHandler);
    return keywordHandler;
}
```

**Avnesh Kumar:** each handler tries to process, if it can't it passes to next

**Vachan Jalady:** what's EvaluatorAdapterHandler?

**Avnesh Kumar:** adapter between handler chain and actual evaluators (RegexEvaluator, KeywordEvaluator)

**Avnesh Kumar:** keeps evaluation logic separate from chain logic

**Manan Kumar:** +1 clean separation of concerns

---

## Thread 4: Kafka Consumer Implementation (Wednesday Week 1, 11am)

**Vachan Jalady:** building MessageConsumer to listen for canonical service events

**Vachan Jalady:** @KafkaListener on topic "canonical-messages"

**Vachan Jalady:** receives CanonicalMessage, evaluates against all policies, creates flags if violations found

**Manan Kumar:** are you loading all policies into memory on startup?

**Vachan Jalady:** yeah @PostConstruct loads all enabled policies

**Vachan Jalady:** caches them for fast evaluation

**Adarsh Maurya:** what if policy is updated while service is running?

**Vachan Jalady:** hmm good point

**Vachan Jalady:** need cache invalidation strategy

**Manan Kumar:** add TTL refresh every 5 min

**Manan Kumar:** or better - publish cache invalidation event when policy updated

**Vachan Jalady:** adding policy update listener

**Vachan Jalady:** when PolicyService.update() called → publish event → all instances reload cache

---

## Thread 5: Regex Complexity Scoring (Thursday Week 1, 9am)

**Avnesh Kumar:** working on regex safety for RegexEvaluator

**Avnesh Kumar:** complexity scoring: count nested quantifiers, alternations, character classes

**Avnesh Kumar:** formula: score = (nestedQuantifiers * 10) + (alternations * 5) + (charClasses * 2)

**Adarsh Maurya:** threshold?

**Avnesh Kumar:** if score > 100 → reject policy at creation time

**Avnesh Kumar:** "Policy regex too complex, may cause performance issues"

**Vachan Jalady:** also timeout during evaluation right?

**Avnesh Kumar:** yeah using CompletableFuture with timeout:

```java
CompletableFuture.supplyAsync(() -> pattern.matcher(text).find())
    .get(50, TimeUnit.MILLISECONDS);
```

**Avnesh Kumar:** if timeout → log warning, skip policy, continue with others

**Manan Kumar:** skip policy not fail message. smart

**Manan Kumar:** better to miss one violation than block legitimate messages

---

## Thread 6: Flag Entity & Repository (Friday Week 1, 10am)

**Vachan Jalady:** implemented Flag entity for policy hits

```java
@Entity
@Table(name = "flags")
public class Flag {
    @Id
    private String id;
    private String messageId;
    private String policyId;
    private String policyName;
    private String tenantId;
    private Instant flaggedAt;
    private String severity;
    private String matchedContent;  // what triggered the policy
}
```

**Manan Kumar:** matchedContent - is that the full message or just the matching part?

**Vachan Jalady:** just the matching part

**Vachan Jalady:** like if regex matches "credit card: 4532-1234-5678-9010", store that snippet

**Vachan Jalady:** compliance officer can see what triggered without reading full email

**Adarsh Maurya:** privacy concern tho

**Adarsh Maurya:** what if matched content contains sensitive info?

**Vachan Jalady:** encrypt it before storing?

**Anand Kummari:** or just store first 100 chars with "..." if longer

**Anand Kummari:** enough context without exposing everything

**Vachan Jalady:** going with 100 char truncation for MVP

---

## Thread 7: Notification Service Design (Monday Week 2, 9am)

**Anand Kummari:** starting notification service

**Anand Kummari:** when Flag created, send notification to compliance officers

**Anand Kummari:** PRD mentions email via SNS (AWS Simple Notification Service)

**Manan Kumar:** immediate email for every flag?

**Anand Kummari:** that's what PRD says but...

**Anand Kummari:** if we get 200 hits/hour for same policy, that's 200 emails. alert fatigue

**Vachan Jalady:** batch them by severity

**Vachan Jalady:** CRITICAL = immediate, HIGH = hourly digest, MEDIUM/LOW = daily

**Adarsh Maurya:** +1 severity-based batching

**Anand Kummari:** implementing:
- CRITICAL: send immediately via SNS
- HIGH: collect in memory, send hourly summary
- MEDIUM/LOW: store in DB, scheduled job sends daily

**Anand Kummari:** also using HTML template (flagged-email.html) for nice formatting

---

## Thread 8: SNS Integration Issues (Tuesday Week 2, 10am)

**Anand Kummari:** sns integration not working 😤

**Anand Kummari:** SnsConfig looks fine, AmazonSNS client created

**Anand Kummari:** but publish() call throwing "Topic not found"

**Vachan Jalady:** did you create the SNS topic?

**Anand Kummari:** oh... no lol

**Anand Kummari:** need to create topic in AWS console first

**Manan Kumar:** add topic ARN to application.properties

**Manan Kumar:** `aws.sns.topic.arn=arn:aws:sns:us-east-1:123456:compliance-alerts`

**Anand Kummari:** creating topic... subscribing test email... testing publish

**Anand Kummari:** got email ✅ working now

---

## Thread 9: Policy Controller Implementation (Wednesday Week 2, 11am)

**Vachan Jalady:** PolicyController done

**Vachan Jalady:** endpoints:
- POST /api/policies - create policy
- GET /api/policies - list all
- GET /api/policies/{id} - get one
- PUT /api/policies/{id} - update
- DELETE /api/policies/{id} - delete

**Adarsh Maurya:** validation on create?

**Vachan Jalady:** yup using @Valid on request body

**Vachan Jalady:** checks: name not empty, severity valid, at least one condition

**Vachan Jalady:** for regex policies, runs complexity check before saving

**Manan Kumar:** what about tenant isolation?

**Vachan Jalady:** every policy has tenantId

**Vachan Jalady:** GET only returns policies for requesting tenant (from JWT)

**Vachan Jalady:** PUT/DELETE check tenantId matches before modifying

**Avnesh Kumar:** nice. prevents cross-tenant policy access

---

## Thread 10: Audit Logging Integration (Thursday Week 2, 9am)

**Adarsh Maurya:** adding audit logging with AuditLoggingAspect

**Adarsh Maurya:** @Around on PolicyController and PolicyHitsController methods

**Adarsh Maurya:** logs: policy created, updated, deleted, policy hit generated

**Vachan Jalady:** using Feign client to call audit service?

**Adarsh Maurya:** yup AuditClient with @FeignClient annotation

**Adarsh Maurya:** POST /api/audit with AuditLogRequest

**Manan Kumar:** what if audit service is down?

**Adarsh Maurya:** circuit breaker with fallback

**Adarsh Maurya:** logs to local file, async job replays later

**Adarsh Maurya:** using Resilience4j: @CircuitBreaker(name = "audit", fallbackMethod = "auditFallback")

**Avnesh Kumar:** good defensive programming

---

## Thread 11: Evaluator Testing (Friday Week 2, 10am)

**Avnesh Kumar:** writing tests for RegexEvaluator and KeywordEvaluator

**Avnesh Kumar:** test cases:
- simple regex match ✅
- complex regex with timeout ✅  
- keyword list matching ✅
- case insensitive keyword ✅

**Avnesh Kumar:** but found bug with KeywordEvaluator

**Avnesh Kumar:** searching for "confidential" matches "Confidential Information" but also "unconFIDENTIAL" 🤦

**Manan Kumar:** word boundary issue

**Manan Kumar:** need `\b` boundaries or .contains() with proper tokenization

**Avnesh Kumar:** switching to word boundary regex: `\b(?i)confidential\b`

**Avnesh Kumar:** retesting... ok only matches whole word now ✅

---

## Thread 12: Policy Hits Controller (Monday Week 3, 9am)

**Vachan Jalady:** implementing PolicyHitsController

**Vachan Jalady:** GET /api/policy-hits - query flags with filters

**Vachan Jalady:** filters: tenantId, policyId, severity, dateRange, status

**Adarsh Maurya:** pagination?

**Vachan Jalady:** yup using Pageable

**Vachan Jalady:** default page=0, size=50, sort by flaggedAt desc

**Vachan Jalady:** returns FlagDto not entity (hide internal details)

**Manan Kumar:** can compliance officers mark flags as reviewed?

**Vachan Jalady:** good idea, adding status field

**Vachan Jalady:** NEW, REVIEWED, FALSE_POSITIVE, ESCALATED

**Vachan Jalady:** PUT /api/policy-hits/{id}/status to update

---

## Thread 13: Notification Batching Implementation (Tuesday Week 3, 10am)

**Anand Kummari:** implemented batching for HIGH severity notifications

**Anand Kummari:** scheduled job runs hourly via @Scheduled(cron = "0 0 * * * *")

**Anand Kummari:** collects all HIGH flags from last hour, groups by policy

**Anand Kummari:** sends summary: "Policy 'PII Detection' triggered 45 times, top 5 senders..."

**Vachan Jalady:** using the HTML template?

**Anand Kummari:** yeah flagged-email.html with Thymeleaf

**Anand Kummari:** renders table with: policy name, hit count, sample messages

**Adarsh Maurya:** what about CRITICAL that should be immediate?

**Anand Kummari:** separate code path

**Anand Kummari:** CRITICAL flags trigger NotificationPublisher.publishImmediate()

**Anand Kummari:** sends within seconds via SNS

---

## Thread 14: Integration Testing (Wednesday Week 3, 11am)

**Avnesh Kumar:** setting up integration tests

**Avnesh Kumar:** test flow: kafka message → policy evaluation → flag created → notification sent

**Manan Kumar:** using embedded kafka?

**Avnesh Kumar:** yeah @EmbeddedKafka annotation

**Avnesh Kumar:** publish test message, verify flag created in DB

**Avnesh Kumar:** mocking SNS to avoid actual email sends

**Vachan Jalady:** test cases:
- message matches regex policy → flag created ✅
- message matches keyword policy → flag created ✅  
- message matches no policies → no flag ✅
- critical policy → immediate notification ✅
- high policy → batched notification ✅

**Avnesh Kumar:** all passing 🚀

---

## Thread 15: Performance Load Testing (Thursday Week 3, 9am)

**Manan Kumar:** load testing with 5k msg/sec from canonical

**Manan Kumar:** 500 policies loaded in memory

**Manan Kumar:** results: p50=15ms, p95=45ms, p99=120ms (evaluation time)

**Adarsh Maurya:** CPU usage?

**Manan Kumar:** 55% average, spikes to 75%

**Manan Kumar:** memory stable at 1.2GB (policy cache + evaluation threads)

**Vachan Jalady:** any regex timeouts?

**Manan Kumar:** 3 policies hit 50ms timeout during test

**Manan Kumar:** they were skipped, logged warnings, didn't affect throughput

**Avnesh Kumar:** ramping to 10k msg/sec...

**Avnesh Kumar:** p50=18ms, p95=65ms, p99=180ms

**Avnesh Kumar:** CPU at 80%, within acceptable range

**Manan Kumar:** we're good for target throughput ✅

---

## Thread 16: Tenant Configuration (Friday Week 3, 10am)

**Vachan Jalady:** added Tenant entity and TenantService

**Vachan Jalady:** tenant config includes: notification preferences, policy quotas, rate limits

**Vachan Jalady:** TenantController endpoints:
- GET /api/tenants/{id} - get config
- PUT /api/tenants/{id} - update config

**Adarsh Maurya:** what notification preferences?

**Vachan Jalady:** email addresses to notify, batch intervals, severity thresholds

**Vachan Jalady:** tenant can say "only notify me for CRITICAL, ignore LOW"

**Manan Kumar:** policy quotas?

**Vachan Jalady:** max policies per tenant

**Vachan Jalady:** enterprise: 1000, standard: 100, free: 10

**Vachan Jalady:** enforced in PolicyService.create()

**Anand Kummari:** nice tiered approach

---

## Thread 17: Exception Handling Review (Monday Week 4, 9am)

**Adarsh Maurya:** reviewing GlobalExceptionHandler

**Adarsh Maurya:** covering:
- ValidationException → 400
- NotFoundException → 404  
- BadRequestException → 400
- Generic Exception → 500

**Adarsh Maurya:** returns ApiError with timestamp, status, message, path

**Vachan Jalady:** should we include request ID?

**Adarsh Maurya:** good idea for tracing

**Adarsh Maurya:** adding request-id header + MDC logging

**Manan Kumar:** also stack trace for 500 errors?

**Adarsh Maurya:** only in dev/staging

**Adarsh Maurya:** production hides stack trace, logs it server-side

---

## Thread 18: Code Review Session (Tuesday Week 4, 10am)

**Adarsh Maurya:** final review before staging

**Adarsh Maurya:** entity package ✅
- Policy hierarchy with RegexPolicy, KeywordPolicy
- Flag for tracking hits
- Tenant for config

**Vachan Jalady:** evaluators package ✅  
- RegexEvaluator with complexity scoring + timeout
- KeywordEvaluator with word boundary matching
- Chain of responsibility pattern

**Anand Kummari:** notifications package ✅
- SNS integration for immediate alerts
- Batching for HIGH/MEDIUM/LOW severity
- HTML email templates

**Avnesh Kumar:** kafka consumer ✅
- MessageConsumer listening to canonical events
- Policy cache with refresh strategy
- Flag creation on violations

**Manan Kumar:** controllers ✅
- PolicyController for CRUD
- PolicyHitsController for flag queries
- TenantController for config

**Adarsh Maurya:** tests all passing?

**Avnesh Kumar:** 52 unit tests ✅, 8 integration tests ✅

**Adarsh Maurya:** approved for staging deploy

---

## Thread 19: Staging Deployment (Wednesday Week 4, 9am)

**Manan Kumar:** deploying to staging...

**Manan Kumar:** PostgreSQL: connected ✅

**Manan Kumar:** Kafka consumer: subscribed to canonical-messages ✅

**Manan Kumar:** SNS: topic verified ✅

**Manan Kumar:** health check: /actuator/health → UP ✅

**Avnesh Kumar:** testing policy creation

**Avnesh Kumar:** POST /api/policies with regex policy

**Avnesh Kumar:** 201 Created, stored in DB ✅

**Vachan Jalady:** testing evaluation flow

**Vachan Jalady:** publishing test message to kafka with PII (SSN pattern)

**Vachan Jalady:** policy evaluated... flag created ✅

**Vachan Jalady:** notification sent via SNS ✅ (got email)

**Anand Kummari:** testing batch notifications

**Anand Kummari:** created 20 HIGH severity flags in last hour

**Anand Kummari:** scheduled job ran... received single digest email with all 20 ✅

**Adarsh Maurya:** staging looks solid

**Adarsh Maurya:** 48hr soak test starting

---

## Thread 20: ReDoS Protection Validation (Thursday Week 4, 10am)

**Avnesh Kumar:** testing regex safety in staging

**Avnesh Kumar:** created policy with evil regex: `/^(a+)+b$/`

**Avnesh Kumar:** complexity score: 250 (way over threshold of 100)

**Avnesh Kumar:** policy creation rejected ✅

**Avnesh Kumar:** "Policy regex too complex (score: 250), maximum allowed: 100"

**Adarsh Maurya:** what about existing policies that timeout?

**Avnesh Kumar:** sending message that triggers long regex

**Avnesh Kumar:** evaluation started... 50ms timeout hit... policy skipped

**Avnesh Kumar:** warning logged: "Policy 'Test-123' evaluation timed out after 50ms"

**Avnesh Kumar:** message still processed by other policies ✅

**Manan Kumar:** perfect. ReDoS protection working

---

## Thread 21: Production Deployment (Monday Week 5, 9am)

**Adarsh Maurya:** soak test results:

**Adarsh Maurya:** total messages evaluated: 2.1M

**Adarsh Maurya:** avg throughput: 486 msg/sec

**Adarsh Maurya:** flags created: 1,247 (0.06% hit rate)

**Adarsh Maurya:** p95 evaluation latency: 52ms

**Adarsh Maurya:** errors: 0 system errors, 2 regex timeouts (logged + skipped)

**Manan Kumar:** ready for prod

**Manan Kumar:** configs verified:
- PostgreSQL: prod cluster ✅
- Kafka: prod brokers ✅  
- SNS: prod topic ✅
- policies loaded: 150 ✅

**Vachan Jalady:** deploying to prod...

**Vachan Jalady:** health check passing ✅

**Vachan Jalady:** kafka consumer connected ✅

**Vachan Jalady:** traffic ramping: 10%... 50%... 100% ✅

**Avnesh Kumar:** first production policy evaluation... SUCCESS ✅

**Avnesh Kumar:** message with PII detected, flag created, notification sent ✅

**Anand Kummari:** monitoring dashboards live

**Anand Kummari:** evaluation latencies nominal, no errors

**Adarsh Maurya:** compliance service is LIVE 🚀

**Manan Kumar:** protecting the organization from policy violations 🛡️

---

## Thread 22: First Critical Alert (Tuesday Week 5, 10am)

**Anand Kummari:** just got first CRITICAL alert in prod

**Anand Kummari:** policy detected potential data breach - employee emailing customer list to personal email

**Vachan Jalady:** notification sent immediately?

**Anand Kummari:** yup SNS delivered within 3 seconds

**Anand Kummari:** compliance officer already investigating

**Adarsh Maurya:** flag marked as ESCALATED in system

**Adarsh Maurya:** audit trail shows: detected → notified → reviewed → escalated

**Manan Kumar:** this is why we built it 💪

**Avnesh Kumar:** compliance service doing its job

---

## Thread 23: Retrospective (Friday Week 5, 2pm)

**Adarsh Maurya:** retro time. what went well?

**Avnesh Kumar:** chain of responsibility pattern was perfect

**Avnesh Kumar:** made adding new evaluators super easy

**Anand Kummari:** +1 and SNS integration was smoother than expected

**Anand Kummari:** batching notifications cut alert fatigue by 90%

**Vachan Jalady:** regex complexity scoring saved us

**Vachan Jalady:** caught 3 potentially dangerous patterns before they hit prod

**Manan Kumar:** what could improve?

**Adarsh Maurya:** policy testing dashboard didn't make this sprint

**Adarsh Maurya:** operators want to test policies on sample data before publishing

**Vachan Jalady:** yeah that's next sprint priority

**Manan Kumar:** also retroactive evaluation

**Manan Kumar:** when policy updated, re-evaluate past messages

**Avnesh Kumar:** overall tho... solid delivery

**Avnesh Kumar:** 5 weeks from PRD to prod, catching real violations

**Adarsh Maurya:** compliance service: SHIPPED ✅

---

## Summary

**Implementation Timeline:**
- Week 1: Entity design, chain of responsibility, kafka consumer
- Week 2: Policy evaluation, notification service, SNS integration  
- Week 3: Batching, tenant config, performance testing
- Week 4: Exception handling, staging deployment, ReDoS validation
- Week 5: Production deployment, monitoring, first alerts

**Key Technical Decisions:**
1. Chain of Responsibility pattern for extensible policy evaluation
2. Regex complexity scoring (threshold: 100) to prevent ReDoS attacks
3. 50ms evaluation timeout with policy skip fallback
4. Severity-based notification batching (CRITICAL immediate, others batched)
5. In-memory policy cache with 5-minute TTL + invalidation events
6. SNS for reliable email delivery with HTML templates
7. Tenant configuration for quotas and preferences

**Challenges Overcome:**
1. ReDoS vulnerability - solved with complexity scoring + timeout
2. Alert fatigue - solved with severity-based batching
3. Kafka consumer cache staleness - solved with invalidation events
4. Keyword false matches - solved with word boundary regex
5. SNS topic missing - created in AWS console

**Final Production Metrics:**
- Throughput: 486 msg/sec sustained (10k target with 500 policies)
- Evaluation latency: p95=52ms (within 100ms SLA)
- Hit rate: 0.06% (1,247 violations per 2.1M messages)
- Regex timeouts: 2 in 48hrs (both skipped gracefully)
- Critical alerts: Response time <3 seconds from detection to notification
- Availability: 100% uptime post-deployment

**Architecture Delivered:**
- Policy Management: CRUD API with validation + complexity checks
- Evaluation Engine: Chain of responsibility with regex/keyword evaluators
- Kafka Consumer: Listens to canonical-messages topic
- Notification Service: SNS integration with batching by severity
- Flag Tracking: PostgreSQL storage with query API
- Tenant Configuration: Per-tenant quotas and preferences
- Audit Integration: Circuit breaker protected Feign client
- Observability: Prometheus metrics + structured logging

**Real-World Impact:**
- First critical alert detected data breach attempt within 24hrs of production
- 90% reduction in alert fatigue with batching
- Zero false negatives due to ReDoS (all timeouts handled gracefully)
- Compliance officers can investigate violations in real-time

**Status:** ✅ Production deployment successful, actively detecting violations

