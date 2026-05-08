export type Action =
  | { kind: "call"; function: string; args: Arg[]; assignTo?: string }
  | { kind: "assign"; target: string; value: string | Action }
  | { kind: "return"; value: string | Action }
  | { kind: "if"; condition: string; thenActions: Action[]; elseActions?: Action[] }
  | { kind: "for"; variable: string; iterable: string; bodyActions: Action[] };

export type Arg = { name: string; type: string; value: string | Action };
