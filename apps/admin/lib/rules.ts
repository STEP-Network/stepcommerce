// Product rules engine (spec §3 product_rule): compiles a conditions JSONB
// tree into a parameterized SQL WHERE clause over the product table.
// conditions = {"all": [...]} | {"any": [...]} | flat array (implicit AND);
// leaves = {field, operator, value}. Operators: equals | contains | in | gt | lt | exists.
// Fields are whitelisted — nothing from the JSONB ever reaches SQL as text.

const FIELDS: Record<string, { column: string; numeric?: boolean }> = {
  title: { column: 'title' },
  description: { column: 'description' },
  link: { column: 'link' },
  price: { column: 'price_amount', numeric: true },
  sale_price: { column: 'sale_price_amount', numeric: true },
  availability: { column: 'availability' },
  brand: { column: 'brand' },
  gtin: { column: 'gtin' },
  product_type: { column: 'product_type' },
  google_product_category: { column: 'google_product_category' },
  custom_label_0: { column: 'custom_label_0' },
  custom_label_1: { column: 'custom_label_1' },
  custom_label_2: { column: 'custom_label_2' },
  custom_label_3: { column: 'custom_label_3' },
  custom_label_4: { column: 'custom_label_4' },
};

export interface RuleLeaf {
  field: string;
  operator: 'equals' | 'contains' | 'in' | 'gt' | 'lt' | 'exists';
  value?: unknown;
}
export type RuleConditions = RuleLeaf[] | { all?: RuleNode[]; any?: RuleNode[] };
export type RuleNode = RuleLeaf | { all?: RuleNode[]; any?: RuleNode[] };

class SqlBuilder {
  clauses: string[] = [];
  params: unknown[] = [];
  private offset: number;
  /** Prefix for column references, e.g. "p." when the query aliases product. */
  readonly prefix: string;
  constructor(paramOffset: number, prefix = '') {
    this.offset = paramOffset;
    this.prefix = prefix;
  }
  bind(value: unknown): string {
    this.params.push(value);
    return `$${this.offset + this.params.length}`;
  }
}

function compileNode(node: RuleNode, b: SqlBuilder): string {
  if ('all' in node || 'any' in node) {
    const group = node as { all?: RuleNode[]; any?: RuleNode[] };
    const children = group.all ?? group.any ?? [];
    // An empty group must NOT compile to `true`: that turns the rule into
    // "match every product in the feed", which serves the whole catalogue on
    // any page. Rejecting it surfaces as a save error in the admin and as
    // render:false at serve time.
    if (!children.length) throw new Error('Empty rule group — remove it or add a condition');
    const joiner = group.all ? ' and ' : ' or ';
    return '(' + children.map((c) => compileNode(c, b)).join(joiner) + ')';
  }
  const leaf = node as RuleLeaf;
  const field = FIELDS[leaf.field];
  if (!field) throw new Error(`Unknown rule field: ${leaf.field}`);
  const col = b.prefix + field.column;
  switch (leaf.operator) {
    case 'equals':
      return `${col} = ${b.bind(String(leaf.value))}${field.numeric ? '::numeric' : ''}`;
    case 'contains':
      if (field.numeric) throw new Error(`contains not valid on numeric field ${leaf.field}`);
      return `${col} ilike ${b.bind('%' + String(leaf.value) + '%')}`;
    case 'in': {
      const values = Array.isArray(leaf.value) ? leaf.value.map(String) : [String(leaf.value)];
      return `${col} = any(${b.bind(values)})`;
    }
    case 'gt':
    case 'lt': {
      // Guard the cast: `title > $1::numeric` type-errors at SERVE time, where
      // the throw is swallowed and the widget just goes dark.
      if (!field.numeric) throw new Error(`${leaf.operator} is only valid on numeric fields, not ${leaf.field}`);
      if (!/^-?\d+(\.\d+)?$/.test(String(leaf.value))) {
        throw new Error(`${leaf.operator} needs a numeric value, got "${String(leaf.value)}"`);
      }
      return `${col} ${leaf.operator === 'gt' ? '>' : '<'} ${b.bind(String(leaf.value))}::numeric`;
    }
    case 'exists':
      return `${col} is not null`;
    default:
      throw new Error(`Unknown operator: ${String(leaf.operator)}`);
  }
}

/**
 * Compiles conditions to {where, params}. Param placeholders start at
 * $<paramOffset+1>. `columnPrefix` qualifies column names for queries that
 * alias the product table (e.g. "p.").
 */
export function compileRule(
  conditions: RuleConditions,
  paramOffset = 0,
  columnPrefix = '',
): { where: string; params: unknown[] } {
  const b = new SqlBuilder(paramOffset, columnPrefix);
  const root: RuleNode = Array.isArray(conditions) ? { all: conditions } : conditions;
  const where = compileNode(root, b);
  return { where, params: b.params };
}
