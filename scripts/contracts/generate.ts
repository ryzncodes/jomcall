import { writeFileSync } from "node:fs";
import { z } from "zod";
import { commands } from "../../packages/contracts/src/core.ts";
const error = {
  description:
    "Request rejected. Errors contain safe codes, never raw database details.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["ok", "error", "requestId"],
        properties: {
          ok: { const: false },
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
          },
          requestId: { type: "string", format: "uuid" },
        },
      },
    },
  },
};
const paths: Record<string, Record<string, unknown>> = {};
for (const [name, c] of Object.entries(commands)) {
  const schema = z.toJSONSchema(c.input, { unrepresentable: "any" }) as {
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  delete schema.$schema;
  const pathFields = [...c.path.matchAll(/:([a-zA-Z]+)/g)].map((m) => m[1]);
  const route = "/api/v1" + c.path.replace(/:([a-zA-Z]+)/g, "{$1}");
  const properties = { ...schema.properties };
  for (const field of pathFields) delete properties[field];
  const params: unknown[] = pathFields.map((name) => ({
    in: "path",
    name,
    required: true,
    schema: { type: "string", format: "uuid" },
  }));
  if (
    ![
      "session",
      "organizations",
      "createOrganization",
      "acceptInvite",
    ].includes(name)
  )
    params.push({
      in: "header",
      name: "X-Organization-Id",
      required: true,
      schema: { type: "string", format: "uuid" },
      description:
        "Workspace selection; server rechecks membership. Never authority by itself.",
    });
  if (c.method === "GET")
    for (const [k, v] of Object.entries(properties))
      params.push({ in: "query", name: k, required: false, schema: v });
  else
    params.push(
      {
        in: "header",
        name: "Idempotency-Key",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      {
        in: "header",
        name: "X-CSRF-Token",
        required: true,
        schema: { type: "string" },
      },
    );
  const operation = {
    operationId: name,
    parameters: params,
    description:
      "Local-only core command. Custom validation, revision conflicts and authorization are enforced by the server.",
    ...(c.method !== "GET"
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  ...schema,
                  properties,
                  required: schema.required?.filter(
                    (k) => !pathFields.includes(k),
                  ),
                },
              },
            },
          },
        }
      : {}),
    responses: {
      [name === "createOrganization" ? "201" : "200"]: {
        description:
          "Authorized current representation. See TypeScript Output<command> for per-command response types.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Success" },
          },
        },
      },
      "401": error,
      "403": error,
      "404": error,
      "409": error,
      "422": error,
      "503": error,
    },
  };
  (paths[route] ??= {})[c.method.toLowerCase()] = operation;
}
paths["/api/v1/jobs/{id}/download"] = {
  get: {
    operationId: "downloadExport",
    parameters: [
      {
        in: "path",
        name: "id",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      {
        in: "header",
        name: "X-Organization-Id",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      "200": {
        description:
          "Current contact, notes and consent. JSON attachment; no-store; current membership and 24-hour expiry rechecked.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: [
                "manifestVersion",
                "preparedAt",
                "generatedAt",
                "contact",
                "notes",
                "consents",
              ],
            },
          },
        },
      },
      "403": error,
      "404": error,
      "409": error,
      "410": error,
    },
  },
};
for (const action of [
  "csrf",
  "signup",
  "login",
  "refresh",
  "forgot-password",
  "logout",
  "reset-password",
  "confirm",
  "recovery",
]) {
  const get = ["csrf", "confirm", "recovery"].includes(action),
    callback = ["confirm", "recovery"].includes(action);
  paths["/api/auth/" + action] = {
    [get ? "get" : "post"]: {
      operationId: "auth_" + action.replaceAll("-", "_"),
      security: [],
      description: callback
        ? "Single-use local email callback. Only token_hash accepted. Never log this URL."
        : "Local Auth endpoint. POST requires same Origin and CSRF cookie/header pair.",
      parameters: callback
        ? [
            {
              in: "query",
              name: "token_hash",
              required: true,
              schema: { type: "string", pattern: "^[a-f0-9]{40,128}$" },
            },
          ]
        : get
          ? []
          : [
              {
                in: "header",
                name: "X-CSRF-Token",
                required: true,
                schema: { type: "string" },
              },
            ],
      ...(!get
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ...(["signup", "login", "forgot-password"].includes(
                        action,
                      )
                        ? {
                            email: {
                              type: "string",
                              format: "email",
                              maxLength: 254,
                            },
                          }
                        : {}),
                      ...(["signup", "login", "reset-password"].includes(action)
                        ? {
                            password: {
                              type: "string",
                              minLength: 8,
                              maxLength: 128,
                            },
                          }
                        : {}),
                    },
                    required: [
                      ...(["signup", "login", "forgot-password"].includes(
                        action,
                      )
                        ? ["email"]
                        : []),
                      ...(["signup", "login", "reset-password"].includes(action)
                        ? ["password"]
                        : []),
                    ],
                  },
                },
              },
            },
          }
        : {}),
      responses: {
        [callback ? "303" : "200"]: {
          description: callback
            ? "Redirect to local app or password reset form."
            : "Local session or confirmation response.",
          ...(!callback
            ? {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Success" },
                  },
                },
              }
            : {}),
        },
        "401": error,
        "422": error,
        "429": error,
        "503": error,
      },
    },
  };
}
const document = {
  openapi: "3.1.0",
  info: {
    title: "JomCall local core",
    version: "0.1.0",
    description:
      "Phase 1. Runtime mode is server-controlled. Provider actions are unavailable. Request schemas are generated from the named command registry; response envelope is machine-readable, detailed response types live in packages/contracts/src/core.ts. No cloud deployment implied.",
  },
  servers: [{ url: "http://127.0.0.1:4182" }],
  security: [{ localSession: [] }],
  components: {
    securitySchemes: {
      localSession: { type: "apiKey", in: "cookie", name: "ca_local_access" },
    },
    schemas: {
      Success: {
        type: "object",
        required: ["ok", "data", "requestId"],
        properties: {
          ok: { const: true },
          data: {},
          requestId: { type: "string", format: "uuid" },
        },
      },
    },
  },
  paths,
};
writeFileSync(
  "packages/contracts/openapi.json",
  JSON.stringify(document, null, 2) + "\n",
);
console.log(
  `Generated ${Object.keys(paths).length} paths from ${Object.keys(commands).length} core commands plus auth/download endpoints.`,
);
