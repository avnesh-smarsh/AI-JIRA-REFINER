# Implementation Journey - Search Service

**Team:** Adarsh, Vachan, Avnesh, Manan, Anand  
**Timeline:** Sprint 4-5 (3 weeks)  
**Tech Stack:** Spring Boot, Elasticsearch, Kafka, PostgreSQL

---

## Thread 1: PRD Review - The Search Engine (Monday Week 1, 9am)

**Manan Kumar:** got search service PRD from product

**Manan Kumar:** we're building elasticsearch-powered search for compliance officers to query normalized messages

**Adarsh Maurya:** what's the query volume expected?

**Manan Kumar:** PRD says ~100 queries/sec peak, but some complex queries across 30 days of data

**Vachan Jalady:** 30 days at 10k msg/sec = like 26M messages to search through 😬

**Vachan Jalady:** we need serious optimization

**Avnesh Kumar:** what fields are searchable?

**Manan Kumar:** from, to, subject, body, timestamp, tenantId

**Manan Kumar:** PRD wants both exact match and full-text search

**Anand Kummari:** so multi-field mapping then

**Anand Kummari:** text field for full-text, keyword field for exact

**Manan Kumar:** yup exactly

**Manan Kumar:** also need to consume from kafka (canonical service publishes messages)

**Avnesh Kumar:** I'll take elasticsearch config + index mapping

**Vachan Jalady:** I can do kafka consumer + indexing pipeline

**Anand Kummari:** I'll grab search controller + query DSL builder

**Manan Kumar:** me and @Adarsh will handle exception framework + search service layer

---

## Thread 2: Elasticsearch Config Setup (Monday Week 1, 2pm)

**Avnesh Kumar:** working on ElasticConfig

**Avnesh Kumar:** connecting to localhost:9200 for dev

```java
@Configuration
public class ElasticConfig {
    @Bean
    public RestHighLevelClient elasticsearchClient() {
        return new RestHighLevelClient(
            RestClient.builder(new HttpHost("localhost", 9200, "http"))
        );
    }
}
```

**Adarsh Maurya:** should we use RestHighLevelClient or the new ElasticsearchClient?

**Avnesh Kumar:** RestHighLevelClient is deprecated but still works

**Avnesh Kumar:** new client requires ES 8.x, we're on 7.x for now

**Manan Kumar:** stick with RestHighLevelClient for MVP

**Manan Kumar:** we can upgrade to new client when we move to ES 8

**Avnesh Kumar:** k also adding connection test on startup

**Avnesh Kumar:** pings ES cluster, fails fast if unreachable

---

## Thread 3: Message Model Design (Tuesday Week 1, 10am)

**Avnesh Kumar:** designing Message entity for ES indexing

```java
@Document(indexName = "messages")
public class Message {
    @Id
    private String id;
    private String tenantId;
    private String from;
    private String to;
    private String subject;
    private Content body;
    private Context context;
    private Instant timestamp;
}
```

**Adarsh Maurya:** what's Content and Context?

**Avnesh Kumar:** Content has body text + type (plain/html)

**Avnesh Kumar:** Context has metadata like messageType, channel, etc

**Vachan Jalady:** should body be @Field with multi-field mapping?

**Avnesh Kumar:** yeah:

```java
@Field(type = FieldType.Text, analyzer = "standard")
@Field(name = "keyword", type = FieldType.Keyword)
private String body;
```

**Avnesh Kumar:** but hitting issue... Spring Data ES annotations don't support multi-field out of box

**Manan Kumar:** create mapping manually via REST API

**Manan Kumar:** PUT /messages with mapping JSON

**Avnesh Kumar:** trying that approach

---

## Thread 4: Index Mapping Creation (Wednesday Week 1, 11am)

**Avnesh Kumar:** created index mapping manually

```json
{
  "mappings": {
    "properties": {
      "from": {
        "type": "text",
        "fields": {
          "keyword": {"type": "keyword"}
        }
      },
      "to": {
        "type": "text",
        "fields": {
          "keyword": {"type": "keyword"}
        }
      },
      "subject": {
        "type": "text",
        "fields": {
          "keyword": {"type": "keyword"}
        }
      },
      "body": {
        "type": "text",
        "analyzer": "standard"
      }
    }
  }
}
```

**Adarsh Maurya:** looks good. what about analyzer for email addresses?

**Avnesh Kumar:** hmm good point

**Avnesh Kumar:** standard analyzer tokenizes alice@company.com as ["alice", "company", "com"]

**Avnesh Kumar:** that breaks exact email search

**Vachan Jalady:** use keyword field for from/to

**Vachan Jalady:** `from.keyword:alice@company.com` for exact match

**Avnesh Kumar:** yeah already in mapping. text for fuzzy, keyword for exact

---

## Thread 5: Kafka Consumer Implementation (Thursday Week 1, 9am)

**Vachan Jalady:** building kafka consumer to ingest messages

**Vachan Jalady:** @KafkaListener on "normalized-messages" topic

**Vachan Jalady:** receives message, indexes to elasticsearch

**Manan Kumar:** single threaded consumer?

**Vachan Jalady:** yeah for now

**Vachan Jalady:** consuming message by message, indexing individually

**Adarsh Maurya:** that's gonna be slow

**Adarsh Maurya:** 10k msg/sec = 10k index operations. too much overhead

**Vachan Jalady:** oh yeah we need batching

**Vachan Jalady:** collect 100 messages, bulk index

**Manan Kumar:** bulk API is like 10x faster

**Vachan Jalady:** implementing batch collector with 100 msg buffer

**Vachan Jalady:** flush on size (100) or time (1 sec), whichever first

---

## Thread 6: Bulk Indexing Bug (Friday Week 1, 2pm)

**Vachan Jalady:** bulk indexing not working 😤

**Vachan Jalady:** BulkRequest builds fine but BulkResponse shows all failures

**Vachan Jalady:** error: "mapper_parsing_exception: failed to parse field [timestamp]"

**Avnesh Kumar:** what format is timestamp?

**Vachan Jalady:** Instant.now() serialized to JSON

**Avnesh Kumar:** elasticsearch expecting date format

**Avnesh Kumar:** need to configure Jackson to serialize Instant properly

**Vachan Jalady:** adding to config:

```java
@Bean
public ObjectMapper objectMapper() {
    ObjectMapper mapper = new ObjectMapper();
    mapper.registerModule(new JavaTimeModule());
    mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    return mapper;
}
```

**Vachan Jalady:** retesting... ok bulk indexing working now ✅

---

## Thread 7: Search Request DTO Design (Monday Week 2, 9am)

**Anand Kummari:** designing SearchRequest DTO for API

```java
public class SearchRequest {
    private String tenantId;
    private String query;        // free-text search
    private String from;         // filter by sender
    private String to;           // filter by recipient
    private String subject;      // filter by subject
    private LocalDateTime startDate;
    private LocalDateTime endDate;
    private int page = 0;
    private int size = 50;
}
```

**Adarsh Maurya:** validation?

**Anand Kummari:** using javax.validation:

```java
@NotBlank(message = "tenantId is required")
private String tenantId;

@Min(0)
private int page;

@Min(1) @Max(100)
private int size;
```

**Manan Kumar:** should query be required?

**Anand Kummari:** nah optional

**Anand Kummari:** users can filter without free-text search

**Anand Kummari:** like: "show all emails from alice" (no query, just from filter)

---

## Thread 8: Query DSL Builder (Tuesday Week 2, 10am)

**Anand Kummari:** working on SearchCriteriaBuilder

**Anand Kummari:** converts SearchRequest to Elasticsearch QueryBuilder

**Anand Kummari:** logic: if query present → match query on body/subject

**Anand Kummari:** if filters present → add term queries

**Anand Kummari:** if date range → add range query

**Vachan Jalady:** all combined with AND?

**Anand Kummari:** yup BoolQueryBuilder with .must() for each condition

**Adarsh Maurya:** what about OR queries?

**Anand Kummari:** not in MVP

**Anand Kummari:** users can do: `query: "alice OR bob"` and ES handles it

**Anand Kummari:** but API-level OR (multiple from addresses) is phase 2

**Manan Kumar:** fair enough

---

## Thread 9: Exception Handling Framework (Wednesday Week 2, 11am)

**Adarsh Maurya:** building custom exception handling

**Adarsh Maurya:** saw we have strategy pattern for exceptions

**Adarsh Maurya:** ExceptionHandlerStrategy interface, concrete handlers for each exception type

**Manan Kumar:** why not just @ExceptionHandler in controller?

**Adarsh Maurya:** strategy pattern makes it extensible

**Adarsh Maurya:** ExceptionHandlerRegistry maps exception type → handler strategy

**Adarsh Maurya:** GlobalExceptionHandler delegates to registry

**Vachan Jalady:** what exception types are we covering?

**Adarsh Maurya:** 
- InvalidTenantIdException → 400
- SearchCriteriaBuilderException → 400  
- SearchResultProcessingException → 500
- SearchServiceException → 500
- MethodArgumentNotValidException → 400
- TypeMismatchException → 400

**Adarsh Maurya:** all return ErrorResponse with consistent structure

**Anand Kummari:** nice. makes error handling predictable

---

## Thread 10: Search Controller Implementation (Thursday Week 2, 9am)

**Anand Kummari:** SearchController done

```java
@RestController
@RequestMapping("/api/search")
public class SearchController {
    
    @PostMapping
    public ResponseEntity<Page<Message>> search(
        @Valid @RequestBody SearchRequest request
    ) {
        return ResponseEntity.ok(searchService.search(request));
    }
}
```

**Vachan Jalady:** POST for search? usually GET

**Anand Kummari:** POST allows complex request body

**Anand Kummari:** GET with query params gets messy for date ranges, multiple filters

**Adarsh Maurya:** +1 POST is fine for complex search

**Manan Kumar:** what about pagination?

**Anand Kummari:** request has page/size, service returns Spring Page object

**Anand Kummari:** Page includes: content, totalElements, totalPages, pagination metadata

---

## Thread 11: Search Service Layer (Friday Week 2, 10am)

**Manan Kumar:** implementing MessageSearchServiceImpl

**Manan Kumar:** flow: validate tenant → build query → execute search → process results

**Adarsh Maurya:** tenant validation?

**Manan Kumar:** checks if tenantId is valid format (not empty, proper format)

**Manan Kumar:** throws InvalidTenantIdException if invalid

**Vachan Jalady:** query execution using MessageRepository?

**Manan Kumar:** yeah MessageRepository extends ElasticsearchRepository

**Manan Kumar:** also custom MessageCustomRepository for complex queries

**Manan Kumar:** custom repo uses NativeSearchQuery with QueryBuilder from SearchCriteriaBuilder

**Avnesh Kumar:** performance?

**Manan Kumar:** testing with 1M indexed messages... p95 latency is 85ms

**Manan Kumar:** acceptable for MVP

---

## Thread 12: Result Processing Bug (Monday Week 3, 9am)

**Manan Kumar:** found bug in ProcessSearchResults 😬

**Manan Kumar:** when no results found, throwing SearchResultProcessingException

**Manan Kumar:** should return empty list, not error

**Vachan Jalady:** checking the code...

```java
if (searchHits.isEmpty()) {
    throw new SearchResultProcessingException("No results found");
}
```

**Vachan Jalady:** yeah that's wrong. empty results is valid state

**Vachan Jalady:** should return empty Page, not throw

**Manan Kumar:** fixing:

```java
if (searchHits.isEmpty()) {
    return Page.empty();
}
```

**Manan Kumar:** retesting... ok empty queries work now ✅

---

## Thread 13: Multi-field Search Enhancement (Tuesday Week 3, 10am)

**Anand Kummari:** users asking for search across multiple fields

**Anand Kummari:** current query only searches body

**Anand Kummari:** want to search body + subject + from/to

**Vachan Jalady:** use MultiMatchQuery

**Vachan Jalady:** searches multiple fields with same query text

```java
MultiMatchQueryBuilder multiMatch = QueryBuilders
    .multiMatchQuery(request.getQuery())
    .field("subject", 2.0f)   // boost subject 2x
    .field("body", 1.0f)
    .field("from", 1.5f)
    .field("to", 1.5f);
```

**Anand Kummari:** oh boost weights? nice

**Vachan Jalady:** yeah subject matches score higher than body matches

**Vachan Jalady:** makes sense - subject is more important

**Anand Kummari:** implementing that

---

## Thread 14: Integration Testing (Wednesday Week 3, 11am)

**Avnesh Kumar:** setting up integration tests

**Avnesh Kumar:** using @DataElasticsearchTest with embedded ES

**Avnesh Kumar:** test flow: index test data → search → verify results

**Adarsh Maurya:** test cases?

**Avnesh Kumar:**
- search by query text ✅
- search by from filter ✅  
- search by date range ✅
- search with pagination ✅
- empty result handling ✅
- invalid tenantId → 400 ✅

**Avnesh Kumar:** also testing SearchCriteriaBuilder unit tests

**Avnesh Kumar:** verifies correct QueryBuilder generated for each SearchRequest combo

**Manan Kumar:** all green?

**Avnesh Kumar:** 24 tests passing ✅

---

## Thread 15: Performance Load Testing (Thursday Week 3, 9am)

**Manan Kumar:** load testing search endpoint

**Manan Kumar:** indexed 5M messages, running 100 concurrent search queries

**Manan Kumar:** results: p50=45ms, p95=180ms, p99=450ms

**Adarsh Maurya:** that's slow for p99

**Adarsh Maurya:** 450ms is close to timeout

**Vachan Jalady:** what queries are slow?

**Manan Kumar:** date range queries across 30 days

**Manan Kumar:** scanning millions of docs

**Vachan Jalady:** add index on timestamp field

**Vachan Jalady:** also shard allocation - how many shards?

**Manan Kumar:** 1 shard with 5M docs... that's like 8GB

**Manan Kumar:** should be 5 shards, ~1GB each

**Manan Kumar:** reconfiguring... reindexing

**Manan Kumar:** retesting... p50=30ms, p95=95ms, p99=220ms 🚀

**Manan Kumar:** much better

---

## Thread 16: Caching Layer Discussion (Friday Week 3, 10am)

**Adarsh Maurya:** should we add caching for frequent queries?

**Manan Kumar:** what queries are frequent?

**Adarsh Maurya:** checked logs... top 10 queries account for 40% of traffic

**Adarsh Maurya:** like "show all emails from alice in last 7 days"

**Vachan Jalady:** cache with Redis?

**Vachan Jalady:** key = query hash, value = Page<Message>

**Anand Kummari:** TTL?

**Adarsh Maurya:** 1 hour feels right

**Adarsh Maurya:** compliance data doesn't change rapidly

**Manan Kumar:** also add cache bypass option

**Manan Kumar:** request param: `?fresh=true` bypasses cache

**Vachan Jalady:** for MVP let's skip caching

**Vachan Jalady:** 95ms p95 is good enough. add caching in phase 2 if needed

**Adarsh Maurya:** fair

---

## Thread 17: Tenant Isolation Review (Monday Week 4, 9am)

**Adarsh Maurya:** reviewing tenant isolation

**Adarsh Maurya:** every search query filters by tenantId automatically

**Adarsh Maurya:** good. prevents cross-tenant data leaks

**Vachan Jalady:** extracted from JWT?

**Anand Kummari:** yeah SecurityContext has tenantId from JWT claims

**Anand Kummari:** SearchService validates + injects into query

**Manan Kumar:** what if someone tampers with tenantId in request body?

**Anand Kummari:** ignored

**Anand Kummari:** we use JWT tenantId, not request body tenantId

**Anand Kummari:** request body is just for convenience

**Adarsh Maurya:** good. secure by default

---

## Thread 18: Code Review Session (Tuesday Week 4, 10am)

**Adarsh Maurya:** final review before staging

**Adarsh Maurya:** config package ✅
- ElasticConfig with RestHighLevelClient

**Avnesh Kumar:** model package ✅
- Message, Content, Context entities
- proper ES annotations

**Anand Kummari:** controller + dto ✅
- SearchController with validation
- SearchRequest with constraints
- ErrorResponse with consistent structure

**Vachan Jalady:** service + repository ✅
- MessageSearchServiceImpl with query building
- MessageCustomRepository for complex queries
- SearchCriteriaBuilder for QueryBuilder generation

**Manan Kumar:** exception handling ✅
- Strategy pattern with ExceptionHandlerRegistry
- 6 custom exception handlers
- GlobalExceptionHandler delegates properly

**Adarsh Maurya:** utils ✅
- ProcessSearchResults for response mapping
- SearchCriteriaBuilder for query construction

**Avnesh Kumar:** tests all passing?

**Avnesh Kumar:** 24 unit tests ✅, 6 integration tests ✅

**Adarsh Maurya:** approved for staging deploy

---

## Thread 19: Staging Deployment (Wednesday Week 4, 9am)

**Manan Kumar:** deploying to staging...

**Manan Kumar:** Elasticsearch: cluster health GREEN ✅

**Manan Kumar:** Kafka consumer: subscribed to normalized-messages ✅

**Manan Kumar:** health check: /actuator/health → UP ✅

**Avnesh Kumar:** testing search flow

**Avnesh Kumar:** POST /api/search with query "invoice"

**Avnesh Kumar:** 200 OK, returned 15 matches ✅

**Vachan Jalady:** testing filters

**Vachan Jalady:** search with from:alice@company.com

**Vachan Jalady:** 200 OK, all results have alice as sender ✅

**Anand Kummari:** testing pagination

**Anand Kummari:** page=0,size=10 returns 10 results

**Anand Kummari:** page=1,size=10 returns next 10 ✅

**Adarsh Maurya:** testing error handling

**Adarsh Maurya:** empty tenantId → 400 Bad Request ✅

**Adarsh Maurya:** invalid date format → 400 Bad Request ✅

**Manan Kumar:** staging looks solid

**Manan Kumar:** 48hr soak test starting

---

## Thread 20: Kafka Lag Issue (Thursday Week 4, 10am)

**Vachan Jalady:** seeing kafka consumer lag in staging 😬

**Vachan Jalady:** consumer is 5000 messages behind producer

**Manan Kumar:** bulk indexing taking too long?

**Vachan Jalady:** checking logs... bulk requests taking 800ms each

**Vachan Jalady:** that's way too slow

**Avnesh Kumar:** how big are the bulks?

**Vachan Jalady:** 100 messages per bulk

**Avnesh Kumar:** try smaller batches

**Avnesh Kumar:** 100 might be overwhelming ES

**Vachan Jalady:** reducing to 50... testing

**Vachan Jalady:** ok bulk time down to 200ms

**Vachan Jalady:** lag recovering... back to 0 ✅

---

## Thread 21: Production Deployment (Monday Week 5, 9am)

**Adarsh Maurya:** soak test results:

**Adarsh Maurya:** messages indexed: 2.1M

**Adarsh Maurya:** avg throughput: 486 msg/sec

**Adarsh Maurya:** search queries: 8,500

**Adarsh Maurya:** p95 search latency: 102ms

**Adarsh Maurya:** errors: 0.02% (validation errors from bad requests)

**Manan Kumar:** ready for prod

**Manan Kumar:** configs verified:
- Elasticsearch: prod cluster (3 nodes) ✅
- Kafka: prod brokers ✅
- Index shards: 5 shards, 1 replica ✅
- Bulk size: 50 messages ✅

**Vachan Jalady:** deploying to prod...

**Vachan Jalady:** health check passing ✅

**Vachan Jalady:** kafka consumer connected ✅

**Vachan Jalady:** traffic ramping: 10%... 50%... 100% ✅

**Avnesh Kumar:** first production search... SUCCESS ✅

**Avnesh Kumar:** query "phishing" returned 23 results from last 30 days ✅

**Anand Kummari:** monitoring dashboards live

**Anand Kummari:** search latencies nominal, indexing keeping up with canonical

**Adarsh Maurya:** search service is LIVE 🚀

**Manan Kumar:** compliance officers can now search 26M messages in <100ms ⚡

---

## Thread 22: First Production Query (Tuesday Week 5, 10am)

**Anand Kummari:** compliance officer just ran their first complex query

**Anand Kummari:** "show all emails from external domains containing 'confidential' in last 90 days"

**Vachan Jalady:** how long did it take?

**Anand Kummari:** 145ms across 7.8M messages

**Anand Kummari:** returned 1,847 results

**Adarsh Maurya:** that's insane performance 🚀

**Manan Kumar:** multi-field search working?

**Anand Kummari:** yup they searched "credit card" and it matched:
- subject: "Credit Card Statement"
- body: "...your credit card ending in 4532..."
- from addresses with "credit" in name

**Avnesh Kumar:** boosting is helping

**Avnesh Kumar:** subject matches ranked higher in results

**Vachan Jalady:** search service doing its job

---

## Thread 23: Retrospective (Friday Week 5, 2pm)

**Adarsh Maurya:** retro time. what went well?

**Avnesh Kumar:** multi-field mapping was clutch

**Avnesh Kumar:** exact + fuzzy search without code complexity

**Vachan Jalady:** +1 and bulk indexing optimization

**Vachan Jalady:** going from 100 to 50 per batch solved lag issue immediately

**Anand Kummari:** exception handling strategy pattern is clean

**Anand Kummari:** adding new exception handlers is trivial

**Manan Kumar:** what could improve?

**Adarsh Maurya:** should've load tested with proper sharding from day 1

**Adarsh Maurya:** 1 shard → 5 shards reindex wasted time

**Vachan Jalady:** and the timestamp serialization bug

**Vachan Jalady:** caught early but was avoidable with better Jackson config upfront

**Manan Kumar:** caching discussion kept coming up

**Manan Kumar:** should prototype in next sprint

**Avnesh Kumar:** overall tho... solid delivery

**Avnesh Kumar:** 3 weeks from PRD to prod, searching 7M+ messages in <150ms

**Adarsh Maurya:** search service: SHIPPED ✅

---

## Summary

**Implementation Timeline:**
- Week 1: Elasticsearch setup, index mapping, kafka consumer, bulk indexing
- Week 2: Search API, query builder, exception handling, service layer
- Week 3: Testing, performance tuning, multi-field search enhancement
- Week 4: Staging deployment, kafka lag fix, tenant isolation
- Week 5: Production deployment, monitoring, first real queries

**Key Technical Decisions:**
1. Multi-field mapping for flexible search (text + keyword analyzers)
2. Bulk indexing with 50 message batches (optimal throughput vs latency)
3. 5 shards for optimal performance (~1GB per shard)
4. Strategy pattern for exception handling (extensible)
5. POST endpoint for complex search (cleaner than GET with many params)
6. MultiMatchQuery with field boosting (subject 2x, from/to 1.5x, body 1x)
7. Tenant isolation via JWT (secure by default)

**Challenges Overcome:**
1. Timestamp serialization bug - solved with JavaTimeModule
2. Empty results exception - fixed to return empty Page
3. Single shard performance - optimized to 5 shards
4. Kafka consumer lag - reduced bulk size from 100 to 50
5. Slow p99 latency - improved with proper sharding + indexing

**Final Production Metrics:**
- Indexed messages: 7.8M+ (growing)
- Search throughput: 100 queries/sec
- Search latency: p50=30ms, p95=102ms, p99=220ms
- Indexing throughput: 486 msg/sec sustained
- Kafka lag: 0 (keeping up with canonical)
- Error rate: 0.02% (all client validation errors)
- Availability: 100% uptime post-deployment

**Architecture Delivered:**
- REST API: POST /api/search with validation + pagination
- Query Builder: SearchCriteriaBuilder converts SearchRequest to ES QueryBuilder
- Multi-field Search: Searches across subject, body, from, to with boosting
- Bulk Indexing: Kafka consumer with 50-message batches
- Exception Framework: Strategy pattern with 6 custom handlers
- Repository Layer: Spring Data ES + custom repository for complex queries
- Tenant Isolation: JWT-based filtering on all queries

**Real-World Impact:**
- First complex query searched 7.8M messages in 145ms
- Compliance officers can investigate incidents in real-time
- Multi-field search with boosting ranks relevant results first
- 26M+ messages searchable with sub-second latency

**Status:** ✅ Production deployment successful, processing real compliance searches

