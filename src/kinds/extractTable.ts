import { Knex } from "knex";

import InformationSchemaColumn from "../information_schema/InformationSchemaColumn";
import InformationSchemaTable from "../information_schema/InformationSchemaTable";
import PgType from "./PgType";
import commentMapQueryPart from "./query-parts/commentMapQueryPart";
import indexMapQueryPart from "./query-parts/indexMapQueryPart";

export const updateActionMap = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
} as const;

export type UpdateAction =
  (typeof updateActionMap)[keyof typeof updateActionMap];

export type ColumnReference = {
  schemaName: string;
  tableName: string;
  columnName: string;
  onDelete: UpdateAction;
  onUpdate: UpdateAction;
  name: string;
};

export type Index = {
  name: string;
  isPrimary: boolean;
};

export type TableColumnType = {
  fullName: string;
  kind: "base" | "range" | "domain" | "composite" | "enum";
};

export interface TableCheck {
  name: string;
  clause: string;
}

export interface TableColumn {
  name: string;
  expandedType: string;
  type: TableColumnType;
  comment: string | null;
  defaultValue: any;
  isArray: boolean;
  dimensions: number;
  references: ColumnReference[];
  /** @deprecated use references instead */
  reference: ColumnReference | null;
  /** @deprecated use TableDetails.indices instead */
  indices: Index[];
  maxLength: number | null;
  isNullable: boolean;
  isPrimaryKey: boolean;
  generated: "ALWAYS" | "NEVER" | "BY DEFAULT";
  isUpdatable: boolean;
  isIdentity: boolean;
  ordinalPosition: number;

  informationSchemaValue: InformationSchemaColumn;
}

export interface TableIndexColumn {
  /**
   * Column name or null if functional index
   */
  name: string | null;
  /**
   * Definition of index column
   */
  definition: string;
}

export interface TableIndex {
  name: string;
  isPrimary: boolean;
  isUnique: boolean;
  /**
   * Array of index columns in order
   */
  columns: TableIndexColumn[];
}

export interface TableSecurityPolicy {
  name: string;
  isPermissive: boolean;
  rolesAppliedTo: string[];
  commandType: "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  visibilityExpression: string | null;
  modifiabilityExpression: string | null;
}

export interface TableDetails extends PgType<"table"> {
  columns: TableColumn[];
  indices: TableIndex[];
  checks: TableCheck[];
  isRowLevelSecurityEnabled: boolean;
  isRowLevelSecurityEnforced: boolean;
  securityPolicies: TableSecurityPolicy[];
  informationSchemaValue: InformationSchemaTable;
}

const referenceMapQueryPart = `
      SELECT
        source_attr.attname AS "column_name",
        json_agg(json_build_object(
            'schemaName', expanded_constraint.target_schema,
            'tableName', expanded_constraint.target_table,
            'columnName', target_attr.attname,
            'onUpdate', case expanded_constraint.confupdtype
              ${Object.entries(updateActionMap)
                .map(([key, action]) => `when '${key}' then '${action}'`)
                .join("\n")}
              end,
            'onDelete', case expanded_constraint.confdeltype
              ${Object.entries(updateActionMap)
                .map(([key, action]) => `when '${key}' then '${action}'`)
                .join("\n")}
              end,
            'name', expanded_constraint.conname
            )) AS references
      FROM (
        SELECT
          unnest(conkey) AS "source_attnum",
          unnest(confkey) AS "target_attnum",
          target_namespace.nspname as "target_schema",
          target_class.relname as "target_table",
          confrelid,
          conrelid,
          conname,
          confupdtype,
          confdeltype
        FROM
          pg_constraint
          JOIN pg_class source_class ON conrelid = source_class.oid
          JOIN pg_namespace source_namespace ON source_class.relnamespace = source_namespace.oid
    
          JOIN pg_class target_class ON confrelid = target_class.oid
          JOIN pg_namespace target_namespace ON target_class.relnamespace = target_namespace.oid
        WHERE
          source_class.relname = :table_name
          AND source_namespace.nspname = :schema_name
          AND contype = 'f') expanded_constraint
        JOIN pg_attribute target_attr ON target_attr.attrelid = expanded_constraint.confrelid
          AND target_attr.attnum = expanded_constraint.target_attnum
        JOIN pg_attribute source_attr ON source_attr.attrelid = expanded_constraint.conrelid
          AND source_attr.attnum = expanded_constraint.source_attnum
        JOIN pg_class target_class ON target_class.oid = expanded_constraint.confrelid
      WHERE
        target_class.relispartition = FALSE
      GROUP BY
        source_attr.attname
`;

const typeMapQueryPart = `
select
  pg_attribute.attname as "column_name",
  typnamespace::regnamespace::text||'.'||substring(typname, (case when attndims > 0 then 2 else 1 end))::text||repeat('[]', attndims) as "expanded_name",
  attndims as "dimensions",
  json_build_object(
	  'fullName', typnamespace::regnamespace::text||'.'||substring(typname, (case when attndims > 0 then 2 else 1 end))::text,
    'kind', case 
      when typtype = 'd' then 'domain'
      when typtype = 'r' then 'range'
      when typtype = 'c' then 'composite'
      when typtype = 'e' then 'enum'
      when typtype = 'b' then COALESCE((select case 
        when i.typtype = 'r' then 'range' 
        when i.typtype = 'd' then 'domain' 
        when i.typtype = 'c' then 'composite' 
        when i.typtype = 'e' then 'enum' 
      end as inner_kind from pg_type i where i.oid = t.typelem), 'base')
    ELSE 'unknown'
    end
  ) as "type_info"
from pg_type t
join pg_attribute on pg_attribute.atttypid = t.oid
join pg_class on pg_attribute.attrelid = pg_class.oid
join pg_namespace on pg_class.relnamespace = pg_namespace.oid
WHERE
  pg_namespace.nspname = :schema_name
  and pg_class.relname = :table_name
`;

const extractTable = async (
  db: Knex,
  table: PgType<"table">,
): Promise<TableDetails> => {
  const [informationSchemaValue] = await db
    .from("information_schema.tables")
    .where({
      table_name: table.name,
      table_schema: table.schemaName,
    })
    .select<InformationSchemaTable[]>("*");

  const columnsQuery = await db.raw(
    `
    WITH 
    reference_map AS (
      ${referenceMapQueryPart}
    ),
    index_map AS (
      ${indexMapQueryPart}
    ),
    type_map AS (
      ${typeMapQueryPart}
    ),
    comment_map AS (
      ${commentMapQueryPart}
    )
    SELECT
      columns.column_name AS "name",
      type_map.expanded_name AS "expandedType",
      type_map.dimensions AS "dimensions",
      type_map.type_info AS "type",
      comment_map.comment AS "comment",
      character_maximum_length AS "maxLength", 
      column_default AS "defaultValue", 
      is_nullable = 'YES' AS "isNullable", 
      data_type = 'ARRAY' AS "isArray", 
      is_identity = 'YES' AS "isIdentity", 
      is_updatable = 'YES' AS "isUpdatable", 
      ordinal_position AS "ordinalPosition", 
      CASE WHEN is_identity = 'YES' THEN
        identity_generation
      ELSE
        is_generated
      END AS "generated", 
      COALESCE(index_map.is_primary, FALSE) AS "isPrimaryKey", 
      COALESCE(index_map.indices, '[]'::json) AS "indices", 
      COALESCE(reference_map.references, '[]'::json) AS "references", 
      
      row_to_json(columns.*) AS "informationSchemaValue"
    FROM
      information_schema.columns
      LEFT JOIN index_map ON index_map.column_name = columns.column_name
      LEFT JOIN reference_map ON reference_map.column_name = columns.column_name
      LEFT JOIN type_map ON type_map.column_name = columns.column_name
      LEFT JOIN comment_map ON comment_map.column_name = columns.column_name
    WHERE
      table_name = :table_name
      AND table_schema = :schema_name;
  `,
    { table_name: table.name, schema_name: table.schemaName },
  );

  const columns = columnsQuery.rows.map((row: any) => ({
    ...row,
    // Add this deprecated field for backwards compatibility
    reference: row.references[0] ?? null,
  }));

  const indicesQuery = await db.raw(
    `
    WITH index_columns AS (
      SELECT
        ix.indexrelid,
        json_agg(json_build_object(
          'name', a.attname,
          'definition', pg_get_indexdef(ix.indexrelid, keys.key_order::integer, true)
        ) ORDER BY keys.key_order) AS columns
      FROM
        pg_index ix
        CROSS JOIN unnest(ix.indkey) WITH ORDINALITY AS keys(key, key_order)
        LEFT JOIN pg_attribute a ON ix.indrelid = a.attrelid AND key = a.attnum
      GROUP BY ix.indexrelid, ix.indrelid
    )
    SELECT
      i.relname AS "name",
      ix.indisprimary AS "isPrimary",
      ix.indisunique AS "isUnique",
      index_columns.columns
    FROM
      pg_index ix
      INNER JOIN pg_class i ON ix.indexrelid = i.oid
      INNER JOIN pg_class t ON ix.indrelid = t.oid
      INNER JOIN pg_namespace n ON t.relnamespace = n.oid
      INNER JOIN index_columns ON ix.indexrelid = index_columns.indexrelid
    WHERE
      t.relname = :table_name
      AND n.nspname = :schema_name
    `,
    { table_name: table.name, schema_name: table.schemaName },
  );

  const indices = indicesQuery.rows as TableIndex[];

  const checkQuery = await db.raw(
    `
    SELECT
      source_namespace.nspname as "schema",
      source_class.relname as "table",
      json_agg(json_build_object(
                 'name', con.conname,
                 'clause', SUBSTRING(pg_get_constraintdef(con.oid) FROM 7)
      )) as checks
    FROM
     pg_constraint con,
     pg_class source_class,
     pg_namespace source_namespace 
    WHERE
     source_class.relname = :table_name
     AND source_namespace.nspname = :schema_name
     AND conrelid = source_class.oid 
     AND source_class.relnamespace = source_namespace.oid 
     AND con.contype = 'c'
    GROUP BY source_namespace.nspname, source_class.relname;
  `,
    { table_name: table.name, schema_name: table.schemaName },
  );

  const checks = checkQuery.rows
    .flatMap((row: any) => row.checks as TableCheck)
    .map(({ name, clause }: TableCheck) => {
      const numberOfBrackets =
        clause.startsWith("((") && clause.endsWith("))") ? 2 : 1;
      return {
        name,
        clause: clause.slice(
          numberOfBrackets,
          clause.length - numberOfBrackets,
        ),
      };
    });

  const rlsQuery = await db.raw(
    `
    SELECT
      c.relrowsecurity AS "isRowLevelSecurityEnabled",
      c.relforcerowsecurity AS "isRowLevelSecurityEnforced",
      coalesce(json_agg(json_build_object(
        'name', p.policyname,
        'isPermissive', p.permissive = 'PERMISSIVE',
        'rolesAppliedTo', p.roles,
        'commandType', p.cmd,
        'visibilityExpression', p.qual,
        'modifiabilityExpression', p.with_check
      )) FILTER (WHERE p.policyname IS NOT NULL), '[]'::json) AS "securityPolicies"
    FROM
      pg_class c
      INNER JOIN pg_namespace n ON c.relnamespace = n.oid
      LEFT JOIN pg_policies p ON c.relname = p.tablename AND n.nspname = p.schemaname
    WHERE
      c.relname = :table_name
      AND n.nspname = :schema_name
    GROUP BY c.relrowsecurity, c.relforcerowsecurity
    `,
    { table_name: table.name, schema_name: table.schemaName },
  );

  const rls = rlsQuery.rows[0] as {
    isRowLevelSecurityEnabled: boolean;
    isRowLevelSecurityEnforced: boolean;
    securityPolicies: TableSecurityPolicy[];
  };

  return {
    ...table,
    indices,
    checks,
    informationSchemaValue,
    columns,
    ...rls,
  };
};

export default extractTable;
