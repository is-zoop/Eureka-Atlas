UPDATE "meta_column"
SET "normalizedType" = CASE
  WHEN upper("dataType") ~ 'BOOL' THEN 'BOOLEAN'::"StandardDataType"
  WHEN upper("dataType") ~ 'JSON' THEN 'JSON'::"StandardDataType"
  WHEN upper("dataType") ~ 'BLOB|BINARY|BYTEA|RAW|IMAGE' THEN 'BINARY'::"StandardDataType"
  WHEN upper("dataType") ~ 'TIMESTAMP|DATETIME|DATE[[:space:]]*TIME' THEN 'DATETIME'::"StandardDataType"
  WHEN upper("dataType") = 'DATE' THEN 'DATE'::"StandardDataType"
  WHEN upper("dataType") ~ 'DECIMAL|NUMERIC|NUMBER|MONEY|FLOAT|DOUBLE|REAL' THEN 'DECIMAL'::"StandardDataType"
  WHEN upper("dataType") ~ 'INT|SERIAL|YEAR' THEN 'INTEGER'::"StandardDataType"
  WHEN upper("dataType") ~ 'CHAR|TEXT|CLOB|VARCHAR|UUID|XML|ENUM|SET' THEN 'STRING'::"StandardDataType"
  ELSE 'UNKNOWN'::"StandardDataType"
END;
