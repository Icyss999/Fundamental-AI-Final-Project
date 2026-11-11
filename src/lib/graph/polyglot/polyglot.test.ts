import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { matchTestFile } from "@/lib/diagnose/reports";
import { detectEcosystem } from "@/lib/repo/overview";
import { classifyFile, extractGraph } from "../extract";
import { expandUse } from "./extractors/rust";
import { extractEdges } from "./index";
import { scrub } from "./lexer";
import { languageName, LANGUAGES } from "./languages";
import { Project } from "./project";

/** Edges of a mini project as sorted "a -> b" strings. */
function edgesOf(files: Record<string, string>, manifests: Record<string, string> = {}): string[] {
  const warnings: string[] = [];
  const edges = extractEdges(Project.fromFiles(files, manifests), warnings);
  expect(warnings).toEqual([]);
  return [...new Set(edges.map((e) => `${e.source} -> ${e.target}`))].sort();
}

describe("lexing", () => {
  it("drops comments but keeps strings, and can blank strings", () => {
    const python = LANGUAGES.find((l) => l.id === "python")!.syntax;
    const src = 'import a  # import b\ns = "# not a comment"\n"""\nimport c\n"""\n';
    expect(scrub(src, python)).toContain('"# not a comment"');
    expect(scrub(src, python)).not.toContain("import b");
    const bare = scrub(src, python, true);
    expect(bare).not.toContain("import c");
    expect(bare.split("\n")).toHaveLength(src.split("\n").length);
  });

  it("handles nested block comments where the language allows them", () => {
    const rust = LANGUAGES.find((l) => l.id === "rust")!.syntax;
    expect(scrub("a /* x /* y */ z */ b", rust).replace(/\s+/g, " ")).toBe("a b");
  });
});

describe("Python", () => {
  it("resolves absolute, from-, relative and submodule imports, ignoring docstrings", () => {
    expect(
      edgesOf({
        "app/__init__.py": "",
        "app/main.py": '"""\nimport app.unused\n"""\nimport app.models\nfrom app.services import billing\nfrom .utils import helper\nimport os, json\n',
        "app/models.py": "from . import utils\n",
        "app/utils.py": "",
        "app/unused.py": "",
        "app/services/__init__.py": "",
        "app/services/billing.py": "from ..models import Order\nfrom app import (\n    utils,\n)\n",
      }),
    ).toEqual([
      "app/main.py -> app/models.py",
      "app/main.py -> app/services/billing.py",
      "app/main.py -> app/utils.py",
      "app/models.py -> app/utils.py",
      "app/services/billing.py -> app/models.py",
      "app/services/billing.py -> app/utils.py",
    ]);
  });

  it("finds packages under src/ and next to scripts", () => {
    expect(edgesOf({ "src/shop/__init__.py": "", "src/shop/cart.py": "", "tests/test_cart.py": "from shop.cart import Cart\n" })).toEqual(["tests/test_cart.py -> src/shop/cart.py"]);
  });
});

describe("JVM languages", () => {
  it("Java: imports, wildcards, static imports and same-package types", () => {
    expect(
      edgesOf({
        "src/main/java/com/shop/App.java": "package com.shop;\nimport com.shop.model.*;\nimport static com.shop.util.Strings.trim;\npublic class App { Service s = new Service(); }\n",
        "src/main/java/com/shop/Service.java": "package com.shop;\nimport com.shop.model.Order;\nclass Service { Order o; }\n",
        "src/main/java/com/shop/model/Order.java": "package com.shop.model;\npublic class Order {}\n",
        "src/main/java/com/shop/model/Item.java": "package com.shop.model;\npublic record Item(String id) {}\n",
        "src/main/java/com/shop/util/Strings.java": "package com.shop.util;\npublic final class Strings { static String trim(String s) { return s; } }\n",
      }),
    ).toEqual([
      "src/main/java/com/shop/App.java -> src/main/java/com/shop/Service.java",
      "src/main/java/com/shop/App.java -> src/main/java/com/shop/model/Item.java",
      "src/main/java/com/shop/App.java -> src/main/java/com/shop/model/Order.java",
      "src/main/java/com/shop/App.java -> src/main/java/com/shop/util/Strings.java",
      "src/main/java/com/shop/Service.java -> src/main/java/com/shop/model/Order.java",
    ]);
  });

  it("Kotlin: top-level functions and aliases", () => {
    expect(
      edgesOf({
        "app/Main.kt": "package app\nimport app.util.formatPrice as fmt\nfun main() = println(fmt(1.0))\n",
        "app/util/Format.kt": "package app.util\nfun formatPrice(p: Double) = \"$p\"\n",
      }),
    ).toEqual(["app/Main.kt -> app/util/Format.kt"]);
  });
});

describe("Go", () => {
  it("points pkg.Name at the declaring file, and links files of one package", () => {
    expect(
      edgesOf(
        {
          "cmd/server/main.go": 'package main\nimport (\n  "example.com/shop/internal/cart"\n  _ "example.com/shop/internal/db"\n  "fmt"\n)\nfunc main() { fmt.Println(cart.Total(nil)) }\n',
          "internal/cart/cart.go": "package cart\nfunc Total(items []Item) int { return sum(items) }\n",
          "internal/cart/item.go": "package cart\ntype Item struct{ Price int }\n",
          "internal/cart/math.go": "package cart\nfunc sum(items []Item) int { return 0 }\n",
          "internal/cart/cart_test.go": "package cart\nimport \"testing\"\nfunc TestTotal(t *testing.T) { Total(nil) }\n",
          "internal/db/db.go": "package db\nfunc init() {}\n",
        },
        { "go.mod": "module example.com/shop\n\ngo 1.22\n" },
      ),
    ).toEqual([
      "cmd/server/main.go -> internal/cart/cart.go",
      "cmd/server/main.go -> internal/db/db.go",
      "internal/cart/cart.go -> internal/cart/item.go",
      "internal/cart/cart.go -> internal/cart/math.go",
      "internal/cart/cart_test.go -> internal/cart/cart.go",
      "internal/cart/math.go -> internal/cart/item.go",
    ]);
  });
});

describe("Rust", () => {
  it("expands use trees", () => {
    expect(expandUse("crate::a::{b, c::{d, e as f}, self}")).toEqual(["crate::a::b", "crate::a::c::d", "crate::a::c::e", "crate::a"]);
  });

  it("follows mod declarations, crate/super paths and the crate's name from tests", () => {
    expect(
      edgesOf(
        {
          "src/lib.rs": "pub mod db;\npub mod api;\n",
          "src/db/mod.rs": "pub mod models;\n",
          "src/db/models.rs": "pub struct User;\n",
          "src/api.rs": "use crate::db::models::User;\nuse std::fmt;\nfn f() { super::db::models::User; }\n",
          "tests/it.rs": "use my_shop::api;\n",
        },
        { "Cargo.toml": '[package]\nname = "my-shop"\nversion = "0.1.0"\n' },
      ),
    ).toEqual(["src/api.rs -> src/db/models.rs", "src/db/mod.rs -> src/db/models.rs", "src/lib.rs -> src/api.rs", "src/lib.rs -> src/db/mod.rs", "tests/it.rs -> src/api.rs"]);
  });
});

describe("C family", () => {
  it("resolves quoted includes locally, include roots, and project headers in <>", () => {
    expect(
      edgesOf({
        "src/main.c": '#include <stdio.h>\n#include "util.h"\n#include <shop/cart.h>\n// #include "gone.h"\n',
        "src/util.h": "",
        "include/shop/cart.h": '#include "shop/types.h"\n',
        "include/shop/types.h": "",
        "src/cart.cpp": '#include "../include/shop/cart.h"\n',
      }),
    ).toEqual(["include/shop/cart.h -> include/shop/types.h", "src/cart.cpp -> include/shop/cart.h", "src/main.c -> include/shop/cart.h", "src/main.c -> src/util.h"]);
  });
});

describe("C#", () => {
  it("links types through namespaces, usings and global usings", () => {
    expect(
      edgesOf({
        "Shop/Program.cs": "using Shop.Services;\nnamespace Shop;\nclass Program { static void Main() { new CartService(); new Settings(); } }\n",
        "Shop/Settings.cs": "namespace Shop { public class Settings {} }\n",
        "Shop/Services/CartService.cs": "namespace Shop.Services;\npublic class CartService { Logger l; }\n",
        "Shop/Usings.cs": "global using Shop.Infra;\n",
        "Shop/Infra/Logger.cs": "namespace Shop.Infra;\npublic class Logger {}\n",
      }),
    ).toEqual(["Shop/Program.cs -> Shop/Services/CartService.cs", "Shop/Program.cs -> Shop/Settings.cs", "Shop/Services/CartService.cs -> Shop/Infra/Logger.cs"]);
  });
});

describe("PHP, Ruby, Swift, Dart, Vue", () => {
  it("PHP: use statements, PSR-4, same-namespace classes and require", () => {
    expect(
      edgesOf(
        {
          "app/Http/OrderController.php": "<?php\nnamespace App\\Http;\nuse App\\Models\\{Order, User};\nrequire_once __DIR__ . '/../helpers.php';\nclass OrderController extends Controller {}\n",
          "app/Http/Controller.php": "<?php\nnamespace App\\Http;\nabstract class Controller {}\n",
          "app/Models/Order.php": "<?php\nnamespace App\\Models;\nclass Order {}\n",
          "app/Models/User.php": "<?php\nnamespace App\\Models;\nclass User {}\n",
          "app/helpers.php": "<?php\nfunction money() {}\n",
        },
        { "composer.json": JSON.stringify({ autoload: { "psr-4": { "App\\": "app/" } } }) },
      ),
    ).toEqual([
      "app/Http/OrderController.php -> app/Http/Controller.php",
      "app/Http/OrderController.php -> app/Models/Order.php",
      "app/Http/OrderController.php -> app/Models/User.php",
      "app/Http/OrderController.php -> app/helpers.php",
    ]);
  });

  it("Ruby: require_relative and constants", () => {
    expect(
      edgesOf({
        "lib/shop.rb": "require_relative 'shop/cart'\n",
        "lib/shop/cart.rb": "module Shop\n  class Cart\n    def total = Pricing.total(self)\n  end\nend\n",
        "app/services/pricing.rb": "class Pricing\nend\n",
      }),
    ).toEqual(["lib/shop.rb -> lib/shop/cart.rb", "lib/shop/cart.rb -> app/services/pricing.rb"]);
  });

  it("Swift: types used across a module's files", () => {
    expect(
      edgesOf({
        "Sources/Shop/Cart.swift": "struct Cart { var items: [Item] = [] }\n",
        "Sources/Shop/Item.swift": "struct Item { let price: Double }\n",
        "Tests/ShopTests/CartTests.swift": "@testable import Shop\nfinal class CartTests { func test() { _ = Cart() } }\n",
      }),
    ).toEqual(["Sources/Shop/Cart.swift -> Sources/Shop/Item.swift", "Tests/ShopTests/CartTests.swift -> Sources/Shop/Cart.swift"]);
  });

  it("Dart: package: and relative imports", () => {
    expect(
      edgesOf(
        { "lib/main.dart": "import 'package:shop/cart.dart';\nimport 'package:flutter/material.dart';\nimport 'src/theme.dart';\n", "lib/cart.dart": "", "lib/src/theme.dart": "" },
        { "pubspec.yaml": "name: shop\n" },
      ),
    ).toEqual(["lib/main.dart -> lib/cart.dart", "lib/main.dart -> lib/src/theme.dart"]);
  });

  it("Vue: script imports, relative and @/", () => {
    expect(
      edgesOf({
        "src/App.vue": '<template><Cart/></template>\n<script setup lang="ts">\nimport Cart from "./components/Cart.vue";\nimport { api } from "@/lib/api";\n</script>\n',
        "src/components/Cart.vue": "<script>export default {}</script>",
        "src/lib/api.ts": "",
      }),
    ).toEqual(["src/App.vue -> src/components/Cart.vue", "src/App.vue -> src/lib/api.ts"]);
  });
});

describe("the smaller languages", () => {
  it("Lua, Elixir, Erlang, Haskell, Perl, Shell, Clojure", () => {
    expect(
      edgesOf({
        "lua/init.lua": 'local cart = require("shop.cart")\n',
        "lua/shop/cart.lua": "",
        "lib/shop/cart.ex": "defmodule Shop.Cart do\n  alias Shop.Pricing\n  def total(c), do: Pricing.sum(c)\nend\n",
        "lib/shop/pricing.ex": "defmodule Shop.Pricing do\nend\n",
        "src/cart.erl": "-module(cart).\n-include(\"cart.hrl\").\nt() -> pricing:sum([]).\n",
        "src/pricing.erl": "-module(pricing).\n",
        "src/cart.hrl": "",
        "src/Shop/Cart.hs": "module Shop.Cart where\nimport qualified Shop.Pricing as P\n",
        "src/Shop/Pricing.hs": "module Shop.Pricing where\n",
        "lib/Shop/Cart.pm": "package Shop::Cart;\nuse Shop::Pricing;\n",
        "lib/Shop/Pricing.pm": "package Shop::Pricing;\n",
        "bin/run.sh": "#!/bin/sh\n. ./env.sh\nsource \"$HOME/x.sh\"\n",
        "bin/env.sh": "",
        "src/shop/cart.clj": "(ns shop.cart\n  (:require [shop.pricing :as p]))\n",
        "src/shop/pricing.clj": "(ns shop.pricing)\n",
      }),
    ).toEqual([
      "bin/run.sh -> bin/env.sh",
      "lib/Shop/Cart.pm -> lib/Shop/Pricing.pm",
      "lib/shop/cart.ex -> lib/shop/pricing.ex",
      "lua/init.lua -> lua/shop/cart.lua",
      "src/Shop/Cart.hs -> src/Shop/Pricing.hs",
      "src/cart.erl -> src/cart.hrl",
      "src/cart.erl -> src/pricing.erl",
      "src/shop/cart.clj -> src/shop/pricing.clj",
    ]);
  });
});

describe("roles and names across languages", () => {
  it.each([
    ["tests/test_api.py", "test"],
    ["app/api_test.py", "test"],
    ["pkg/cart/cart_test.go", "test"],
    ["src/test/java/com/shop/CartTest.java", "test"],
    ["src/main/java/com/shop/Cart.java", "source"],
    ["spec/models/user_spec.rb", "test"],
    ["Shop.Tests/CartTests.cs", "test"],
    ["Tests/ShopTests/CartTests.swift", "test"],
    ["src/stubs.pyi", "declaration"],
    ["setup.py", "config"],
    ["shop/migrations/0001_initial.py", "config"],
    ["benches/speed.rs", "example"],
    ["MediatR.Examples/Ping.cs", "example"],
    ["src/Latest.java", "source"],
  ])("%s is %s", (id, role) => expect(classifyFile(id)).toBe(role));

  it("names languages for the breakdown", () => {
    expect(["a.py", "b.go", "c.rs", "d.hpp", "e.cs", "f.tsx", "g.unknown"].map(languageName)).toEqual(["Python", "Go", "Rust", "C++", "C#", "TSX", "Other"]);
  });

  it("matches JUnit class names and Go packages in test reports", () => {
    const ids = ["src/test/java/com/shop/CartTest.java", "tests/test_api.py", "internal/cart/cart_test.go"];
    expect(matchTestFile("com.shop.CartTest", ids)).toBe(ids[0]);
    expect(matchTestFile("tests.test_api.TestCheckout", ids)).toBe(ids[1]);
    expect(matchTestFile("example.com/shop/internal/cart", ids)).toBe(ids[2]);
  });

  it("reads other ecosystems' build files for the stack", () => {
    expect(detectEcosystem('django>=5\npytest\n[dependencies]\ntokio = "1"\n').map((t) => t.name)).toEqual(["Django", "pytest", "Tokio"]);
  });
});

describe("extractGraph on a mixed project", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "polyglot-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  };

  it("maps Python and TypeScript side by side, skipping virtualenvs", async () => {
    write("backend/__init__.py", "");
    write("backend/api.py", "from backend import db\n\n\ndef handler():\n    return db.query()\n");
    write("backend/db.py", "def query():\n    return []\n");
    write("backend/tests/test_api.py", "from backend.api import handler\n");
    write(".venv/lib/site.py", "import os\n");
    write("web/index.ts", 'import { get } from "./client";\nget();\n');
    write("web/client.ts", "export const get = () => fetch('/api');\n");
    const { graph, warnings } = await extractGraph(dir);
    expect(warnings).toEqual([]);
    expect(graph.nodes.map((n) => `${n.id}:${n.role}`)).toEqual([
      "backend/__init__.py:source",
      "backend/api.py:source",
      "backend/db.py:source",
      "backend/tests/test_api.py:test",
      "web/client.ts:source",
      "web/index.ts:source",
    ]);
    expect(graph.nodes.find((n) => n.id === "backend/api.py")!.loc).toBe(3);
    expect(graph.edges.map((e) => `${e.source} -> ${e.target}`).sort()).toEqual(["backend/api.py -> backend/db.py", "backend/tests/test_api.py -> backend/api.py", "web/index.ts -> web/client.ts"]);
  }, 30_000);
});
