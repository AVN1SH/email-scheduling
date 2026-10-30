CREATE SEQUENCE "search_revision";
CREATE TABLE "SearchDocument" (
  "emailId" UUID PRIMARY KEY,
  "userId" UUID NOT NULL,
  "namespace" TEXT NOT NULL,
  "revision" BIGINT NOT NULL
);
CREATE INDEX "SearchDocument_namespace_idx" ON "SearchDocument" ("namespace");
CREATE TABLE "SearchCheckpoint" (
  "indexName" TEXT NOT NULL,
  "emailId" UUID NOT NULL,
  "revision" BIGINT NOT NULL,
  PRIMARY KEY ("indexName", "emailId")
);

-- Retain state after hard deletes so delayed index writes cannot resurrect mail.
CREATE FUNCTION record_email_search_change() RETURNS TRIGGER AS $$
DECLARE email_id UUID; batch_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    email_id := OLD.id;
    batch_id := OLD."batchId";
  ELSE
    email_id := NEW.id;
    batch_id := NEW."batchId";
  END IF;
  INSERT INTO "SearchDocument" ("emailId", "userId", namespace, revision)
    SELECT email_id, b."userId", b.namespace, nextval('search_revision')
    FROM "EmailBatch" b WHERE b.id = batch_id
  ON CONFLICT ("emailId") DO UPDATE SET
    "userId" = EXCLUDED."userId", namespace = EXCLUDED.namespace,
    revision = EXCLUDED.revision;
  IF NOT FOUND THEN
    UPDATE "SearchDocument" SET revision = nextval('search_revision') WHERE "emailId" = email_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER email_search_change AFTER INSERT OR UPDATE OR DELETE ON "Email"
FOR EACH ROW EXECUTE FUNCTION record_email_search_change();

CREATE FUNCTION record_batch_search_change() RETURNS TRIGGER AS $$
BEGIN
  UPDATE "SearchDocument" s SET "userId" = NEW."userId", namespace = NEW.namespace,
    revision = nextval('search_revision')
  FROM "Email" e WHERE e.id = s."emailId" AND e."batchId" = NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER batch_search_change AFTER UPDATE OF subject, body, "senderId", "userId", namespace ON "EmailBatch"
FOR EACH ROW EXECUTE FUNCTION record_batch_search_change();

CREATE FUNCTION record_sender_search_change() RETURNS TRIGGER AS $$
BEGIN
  UPDATE "SearchDocument" s SET revision = nextval('search_revision')
  FROM "Email" e JOIN "EmailBatch" b ON b.id = e."batchId"
  WHERE e.id = s."emailId" AND b."senderId" = NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sender_search_change AFTER UPDATE OF name, email ON "Sender"
FOR EACH ROW EXECUTE FUNCTION record_sender_search_change();

INSERT INTO "SearchDocument" ("emailId", "userId", namespace, revision)
SELECT e.id, b."userId", b.namespace, nextval('search_revision')
FROM "Email" e JOIN "EmailBatch" b ON b.id = e."batchId";
