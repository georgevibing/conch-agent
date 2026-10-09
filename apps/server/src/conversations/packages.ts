/**
 * Packages everyone installs (ADR 0117, 2026-10-09): what Auto installs without a word, before
 * and after reading, and what a name one slip away from one of them looks like.
 *
 * Installing a well-known package from its own registry is routine work (Claude Code's auto
 * mode lets dependency installs through; Codex's sandbox draws its line at the network, not at
 * the installer). What a page can steer is the *name*: an unknown package, a URL, another
 * registry, or a name one letter off a famous one (`reqeusts`, `crossenv`) that a squatter
 * registered. Those still ask. The lists are short on purpose: the most-installed packages of
 * each registry, plus a few scopes and module paths only their owners can publish under. A
 * name missing from them isn't suspect, only asked about after reading, as before.
 */

export type Registry = 'pypi' | 'npm' | 'brew' | 'cargo' | 'gem' | 'go';

const words = (text: string) => new Set(text.split(/\s+/).filter(Boolean));

/** PyPI's most installed, and what documents, pictures and data need (names normalised, PEP 503). */
const PYPI = words(`
  pip setuptools wheel virtualenv pipx uv poetry hatch hatchling flit build twine tox nox
  requests urllib3 certifi idna charset-normalizer httpx httpcore aiohttp websockets
  numpy pandas scipy matplotlib seaborn plotly bokeh altair scikit-learn scikit-image statsmodels
  sympy networkx polars pyarrow duckdb numba xarray dask joblib tqdm rich click typer
  pillow opencv-python opencv-python-headless imageio
  fonttools brotli zopfli unicodedata2 reportlab weasyprint fpdf fpdf2 pypdf pypdf2 pdfplumber
  pdfminer-six pymupdf pikepdf pdfkit xhtml2pdf cairosvg cairocffi pycairo svglib markdown
  markdown2 mistune python-markdown-math pygments jinja2 markupsafe docutils sphinx mkdocs
  mkdocs-material python-docx python-pptx openpyxl xlsxwriter xlrd tabulate lxml beautifulsoup4
  html5lib cssselect soupsieve
  pyyaml toml tomli tomli-w ruamel-yaml orjson ujson simplejson python-dotenv attrs pydantic
  pydantic-core pydantic-settings marshmallow dataclasses-json python-dateutil pytz tzdata arrow
  pendulum six typing-extensions packaging filelock platformdirs psutil watchdog
  flask django fastapi starlette uvicorn gunicorn werkzeug itsdangerous sqlalchemy alembic
  psycopg psycopg2 psycopg2-binary pymysql redis celery
  pytest pytest-cov pytest-asyncio pytest-mock pytest-xdist coverage hypothesis mock black ruff
  flake8 pylint isort mypy pyright pre-commit
  boto3 botocore awscli google-cloud-storage google-api-python-client
  openai anthropic tiktoken transformers torch torchvision torchaudio tensorflow keras jax
  sentence-transformers datasets huggingface-hub accelerate safetensors tokenizers langchain
  jupyter jupyterlab notebook ipython ipykernel nbformat nbconvert
  cryptography pyjwt bcrypt paramiko pexpect sh
  selenium playwright scrapy feedparser yt-dlp
`);

/** npm's most installed, the tools a web project uses, and what makes documents and pictures. */
const NPM = words(`
  react react-dom preact vue svelte solid-js lit next nuxt astro remix gatsby vite vitest jest
  mocha chai sinon ava cypress playwright puppeteer typescript ts-node tsx esbuild rollup webpack
  webpack-cli parcel babel-loader swc turbo nx lerna eslint prettier biome stylelint husky
  lint-staged concurrently nodemon cross-env dotenv rimraf del-cli
  express koa fastify hono cors helmet body-parser cookie-parser morgan multer ws socket.io
  axios node-fetch undici got ky superagent
  lodash lodash-es underscore ramda immer zod yup joi ajv valibot date-fns dayjs moment luxon uuid
  nanoid classnames clsx tailwindcss postcss autoprefixer sass less styled-components
  chalk picocolors kleur commander yargs minimist inquirer prompts ora debug semver glob
  fast-glob chokidar fs-extra mkdirp execa zx
  redux react-redux zustand jotai mobx swr react-router react-router-dom react-hook-form
  framer-motion three d3 chart.js echarts recharts lucide-react
  prisma drizzle-orm drizzle-kit mongoose pg mysql2 sqlite3 better-sqlite3 redis ioredis knex
  sequelize typeorm
  pdfkit pdf-lib jspdf pdfjs-dist pdfmake md-to-pdf html-pdf-node sharp canvas jimp svgo
  fontkit opentype.js subset-font markdown-it marked remark rehype unified gray-matter
  highlight.js shiki prismjs katex mermaid docx exceljs xlsx papaparse csv-parse cheerio jsdom
  openai @anthropic-ai/sdk langchain
  create-vite create-next-app create-react-app create-svelte create-astro shadcn degit serve
  http-server live-server npm-check-updates pnpm yarn npm corepack
`);

/** Scopes only their owners publish under: a name in one is theirs, not a squatter's. */
const NPM_SCOPES = words(`
  types babel vitejs vitest testing-library tanstack radix-ui headlessui mui emotion angular vue
  sveltejs nestjs nuxt next aws-sdk google-cloud azure prisma trpc playwright storybook
  typescript-eslint eslint rollup swc remix-run reduxjs reactflow tiptap react-pdf fontsource
  shikijs mdx-js octokit supabase vercel cloudflare anthropic-ai openai modelcontextprotocol
`);

/** Homebrew's most installed formulae and casks. */
const BREW = words(`
  git gh jq yq wget curl tree htop ripgrep fd bat fzf eza tmux neovim vim node nvm pnpm yarn
  python python@3.11 python@3.12 python@3.13 pyenv uv pipx go rust rustup ruby rbenv openjdk
  deno bun cmake ninja make autoconf automake pkg-config gcc llvm
  ffmpeg imagemagick graphicsmagick ghostscript poppler qpdf mupdf pandoc tesseract exiftool
  libvips vips webp jpeg-xl optipng pngquant cairo pango harfbuzz freetype fontconfig
  wkhtmltopdf basictex mactex librsvg
  sqlite postgresql postgresql@16 mysql redis mongodb-community docker colima podman kubectl
  helm terraform awscli azure-cli google-cloud-sdk
  visual-studio-code iterm2 google-chrome firefox font-inter font-fira-code
`);

const CARGO = words(`
  ripgrep fd-find bat exa eza cargo-watch cargo-edit cargo-nextest cargo-expand cargo-audit
  wasm-pack trunk tokei hyperfine just starship zoxide sccache mdbook typst-cli
`);

const GEM = words(
  `bundler rails rake rspec rubocop pry nokogiri jekyll cocoapods fastlane sinatra puma`,
);

/** Module paths only the Go team, or the tool's own maker, publishes under. */
const GO_PREFIXES = [
  'golang.org/x/',
  'google.golang.org/',
  'github.com/golang/',
  'github.com/golangci/golangci-lint/',
  'github.com/go-delve/delve/',
  'honnef.co/go/tools/',
  'mvdan.cc/gofumpt',
  'github.com/air-verse/air',
];

const LISTS: Record<Exclude<Registry, 'go'>, Set<string>> = {
  pypi: PYPI,
  npm: NPM,
  brew: BREW,
  cargo: CARGO,
  gem: GEM,
};

/**
 * Where the languages' own tooling is served from: pip's bootstrap, Python, Node, Rust, Go and
 * uv's installers, and PyPI's package files. What comes from them is their makers' code and
 * archives, not anyone's words. Not `pypi.org` or `registry.npmjs.org`: a package's page there
 * is its author's README.
 */
const TOOLING_HOSTS =
  /^(?:bootstrap\.pypa\.io|files\.pythonhosted\.org|(?:www\.)?python\.org|nodejs\.org|static\.rust-lang\.org|sh\.rustup\.rs|astral\.sh|get\.pnpm\.io|bun\.sh|go\.dev|dl\.google\.com)$/i;

/**
 * One piece of a command fetches only from the tooling's own hosts: at least one address, every
 * one of them theirs, and none worked out as it runs (`$URL`, `$(…)`, backticks).
 */
export function fromTooling(part: string): boolean {
  if (/\$[\w{(]|`/.test(part)) return false;
  const hosts = [...part.matchAll(/https?:\/\/([^/\s"'`)]+)/gi)].map((m) =>
    (m[1] ?? '').replace(/:\d+$/, ''),
  );
  return hosts.length > 0 && hosts.every((h) => TOOLING_HOSTS.test(h));
}

/** A name as its registry compares names: PyPI folds case and `-_.` (PEP 503). */
function normal(registry: Registry, name: string): string {
  const lower = name.toLowerCase();
  return registry === 'pypi' ? lower.replace(/[-_.]+/g, '-') : lower;
}

/**
 * The package a spec names, version, extras and markers taken off: `lodash@4` is lodash,
 * `@types/node@20` is @types/node, `fonttools[woff]>=4.0` is fonttools.
 */
export function packageName(registry: Registry, spec: string): string {
  const raw = spec.replace(/^["']|["']$/g, '');
  if (registry === 'npm') {
    const scoped = raw.startsWith('@');
    const at = raw.indexOf('@', scoped ? 1 : 0);
    return at > 0 ? raw.slice(0, at) : raw;
  }
  if (registry === 'pypi') return raw.split(/[[<>=!~;\s@]/)[0] ?? raw;
  if (registry === 'go') return raw.split('@')[0] ?? raw;
  if (registry === 'cargo' || registry === 'gem') return raw.split(/[@:]/)[0] ?? raw;
  return raw;
}

/** Whether the registry's own most-installed list, or a scope or path only its owner has, holds it. */
export function wellKnown(registry: Registry, name: string): boolean {
  if (registry === 'go')
    return GO_PREFIXES.some((p) => name === p.replace(/\/$/, '') || name.startsWith(p));
  const key = normal(registry, name);
  if (registry === 'npm') {
    const scope = /^@([^/]+)\/[^/]+$/.exec(key)?.[1];
    if (scope) return NPM_SCOPES.has(scope) || NPM.has(key);
  }
  return LISTS[registry].has(key);
}

/** Edits between two names, a swap of neighbours counting as one (Damerau). Stops past 2. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (d[i - 1]?.[j] ?? 0) + 1,
        (d[i]?.[j - 1] ?? 0) + 1,
        (d[i - 1]?.[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, (d[i - 2]?.[j - 2] ?? 0) + 1);
      (d[i] as number[])[j] = best;
    }
  return d[a.length]?.[b.length] ?? 2;
}

/**
 * The well-known package this name imitates, if it does: one letter added, dropped, changed or
 * swapped (`reqeusts`, `numpyy`), or the same letters with the separators moved (`crossenv`,
 * `python-dateutils` aside). Only for names that aren't well known themselves; short names
 * (under five letters) only by their separators, since many short names are a letter apart.
 */
export function imitates(registry: Registry, name: string): string | undefined {
  if (registry === 'go' || wellKnown(registry, name)) return undefined;
  const key = normal(registry, name).replace(/^@[^/]+\//, '');
  const bare = key.replace(/[-_.]/g, '');
  for (const known of LISTS[registry]) {
    if (known === key) continue;
    if (known.replace(/[-_.]/g, '') === bare) return known;
    if (key.length >= 5 && known.length >= 5 && distance(key, known) === 1) return known;
  }
  return undefined;
}
