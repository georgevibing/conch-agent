/**
 * Blocks as a Word document (`.docx`, Office Open XML): real headings (so the
 * navigation pane and a table of contents work), lists, tables with a
 * repeating header row, code, quotes, links, the chat's pictures, and page
 * numbers. Opens in Word, Pages, Google Docs and LibreOffice.
 */
import type { Block, Run } from './blocks';
import { accentOf, type PageSize } from './html';
import {
  appProps,
  contentTypes,
  coreProps,
  EXT,
  fit,
  pack,
  REL,
  rels,
  x,
  XML_HEAD,
  type Part,
  type Picture,
} from './ooxml';

export interface DocxOptions {
  title?: string;
  subtitle?: string;
  size?: PageSize;
  landscape?: boolean;
  accent?: string;
  /** Pictures by the `src` the document gave. */
  pictures?: ReadonlyMap<string, Picture>;
}

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

/** Twentieths of a point, portrait. */
const PAGE_TWIPS: Record<PageSize, { w: number; h: number }> = {
  A4: { w: 11906, h: 16838 },
  Letter: { w: 12240, h: 15840 },
  Legal: { w: 12240, h: 20160 },
  A5: { w: 8391, h: 11906 },
};
const MARGIN = 1247; // 2.2 cm

class Writer {
  readonly rels: { id: string; type: string; target: string; external?: boolean }[] = [];
  readonly media: Part[] = [];
  readonly nums: string[] = [];
  readonly #links = new Map<string, string>();
  readonly #pictures = new Map<string, { rid: string; picture: Picture }>();
  #drawing = 0;

  constructor(
    readonly options: DocxOptions,
    readonly contentWidthEmu: number,
  ) {}

  rid(type: string, target: string, external = false) {
    const id = `rId${this.rels.length + 10}`;
    this.rels.push({ id, type, target, ...(external && { external }) });
    return id;
  }

  link(href: string) {
    let id = this.#links.get(href);
    if (!id) {
      id = this.rid(REL.hyperlink, href, true);
      this.#links.set(href, id);
    }
    return id;
  }

  picture(src: string) {
    const picture = this.options.pictures?.get(src);
    if (!picture) return undefined;
    let found = this.#pictures.get(src);
    if (!found) {
      const name = `media/image${this.#pictures.size + 1}.${EXT[picture.mimeType]}`;
      this.media.push({ path: `word/${name}`, data: picture.bytes });
      found = { rid: this.rid(REL.image, name), picture };
      this.#pictures.set(src, found);
    }
    return found;
  }

  /** An ordered list starts at its own number: a numbering instance of its own. */
  orderedNum(start: number) {
    const id = this.nums.length + 3;
    this.nums.push(
      `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`,
    );
    return id;
  }

  runs(list: readonly Run[], extra = ''): string {
    return list
      .map((run) => {
        if (run.br) return '<w:r><w:br/></w:r>';
        if (run.image) {
          const found = this.picture(run.image.src);
          if (!found)
            return run.image.alt
              ? `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">[${x(run.image.alt)}]</w:t></w:r>`
              : '';
          const { cx, cy } = fit(found.picture, this.contentWidthEmu, 8_000_000);
          const n = ++this.#drawing;
          const alt = x(run.image.alt || found.picture.alt || `Picture ${n}`);
          return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}" descr="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="Picture ${n}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${found.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
        }
        if (!run.text) return '';
        const props = [
          run.link
            ? '<w:rStyle w:val="Hyperlink"/>'
            : run.code
              ? '<w:rStyle w:val="CodeChar"/>'
              : '',
          run.bold ? '<w:b/>' : '',
          run.italic ? '<w:i/>' : '',
          run.strike ? '<w:strike/>' : '',
          extra,
        ].join('');
        const pieces = run.text.split('\t');
        const body = pieces
          .map((piece, i) => `${i ? '<w:tab/>' : ''}<w:t xml:space="preserve">${x(piece)}</w:t>`)
          .join('');
        const r = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${body}</w:r>`;
        return run.link
          ? `<w:hyperlink r:id="${this.link(run.link)}" w:history="1">${r}</w:hyperlink>`
          : r;
      })
      .join('');
  }

  para(style: string | undefined, content: string, props = '') {
    const pPr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${props}`;
    return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;
  }

  blocks(list: readonly Block[], depth = 0, quote = false): string {
    return list
      .map((block) => {
        switch (block.type) {
          case 'heading':
            return this.para(`Heading${block.level}`, this.runs(block.runs));
          case 'paragraph':
            return this.para(quote ? 'Quote' : undefined, this.runs(block.runs));
          case 'list': {
            const num = block.ordered ? this.orderedNum(block.start) : 1;
            return block.items
              .map((item) => {
                const box =
                  item.checked === undefined
                    ? ''
                    : `<w:r><w:t xml:space="preserve">${item.checked ? '☑' : '☐'} </w:t></w:r>`;
                const own = this.para(
                  'ListParagraph',
                  box + this.runs(item.runs),
                  `<w:numPr><w:ilvl w:val="${Math.min(depth, 8)}"/><w:numId w:val="${num}"/></w:numPr>`,
                );
                return own + this.blocks(item.children, depth + 1, quote);
              })
              .join('');
          }
          case 'code':
            return block.text
              .split('\n')
              .map((line) =>
                this.para(
                  'Code',
                  line ? `<w:r><w:t xml:space="preserve">${x(line)}</w:t></w:r>` : '',
                ),
              )
              .join('');
          case 'quote':
            return this.blocks(block.blocks, depth, true);
          case 'table':
            return this.table(block);
          case 'rule':
            return this.para(
              undefined,
              '',
              '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D9DEE3"/></w:pBdr>',
            );
          case 'pagebreak':
            return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
        }
        return '';
      })
      .join('');
  }

  table(block: Extract<Block, { type: 'table' }>) {
    const columns = Math.max(1, block.header.length);
    const width = Math.floor(this.contentWidthEmu / 635 / columns); // EMU → twips
    const accent = accentOf(this.options.accent).slice(1).toUpperCase();
    const jc = (i: number) => {
      const a = block.align[i];
      return a === 'center'
        ? '<w:jc w:val="center"/>'
        : a === 'right'
          ? '<w:jc w:val="right"/>'
          : '';
    };
    const cell = (runs: readonly Run[], i: number, head: boolean) =>
      `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${this.para(
        head ? 'TableHead' : 'TableText',
        this.runs(runs),
        jc(i),
      )}</w:tc>`;
    const header = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${block.header.map((c, i) => cell(c, i, true)).join('')}</w:tr>`;
    const rows = block.rows
      .map(
        (row) =>
          `<w:tr><w:trPr><w:cantSplit/></w:trPr>${block.header.map((_, i) => cell(row[i] ?? [], i, false)).join('')}</w:tr>`,
      )
      .join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9DEE3"/><w:bottom w:val="single" w:sz="4" w:color="D9DEE3"/><w:insideH w:val="single" w:sz="4" w:color="D9DEE3"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${header.replace(/<\/w:tcPr>/g, `<w:shd w:val="clear" w:color="auto" w:fill="${accent}"/></w:tcPr>`)}${rows}</w:tbl>${this.para(undefined, '', '<w:spacing w:after="0"/>')}`;
  }
}

function styles(accent: string) {
  const a = accent.slice(1).toUpperCase();
  const heading = (level: number, size: number, color: string, before: number, extra = '') =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/>${extra}<w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:b/><w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  return `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="1D2329"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="1D2329"/><w:sz w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="8" w:color="D9DEE3"/></w:pBdr><w:spacing w:after="360"/></w:pPr><w:rPr><w:color w:val="59636E"/><w:sz w:val="26"/></w:rPr></w:style>
${heading(1, 40, '1D2329', 360)}
${heading(2, 30, '1D2329', 320, `<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="${a}"/></w:pBdr>`)}
${heading(3, 25, a, 260)}
${heading(4, 22, '1D2329', 220)}
${heading(5, 21, '59636E', 200)}
${heading(6, 21, '59636E', 200)}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="${a}"/></w:pBdr><w:ind w:left="240"/></w:pPr><w:rPr><w:color w:val="59636E"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F6F8"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="120" w:right="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Courier New"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableHead"><w:name w:val="Table Head"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="7A838C"/><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="${a}"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Courier New"/><w:sz w:val="19"/><w:shd w:val="clear" w:color="auto" w:fill="F4F6F8"/></w:rPr></w:style>
</w:styles>`;
}

function numbering(extra: readonly string[]) {
  const bullets = ['•', '◦', '▪', '•', '◦', '▪', '•', '◦', '▪'];
  const levels = (ordered: boolean) =>
    bullets
      .map(
        (b, i) =>
          `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? (i % 3 === 1 ? 'lowerLetter' : i % 3 === 2 ? 'lowerRoman' : 'decimal') : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${i + 1}.` : b}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 * (i + 1) + 360}" w:hanging="360"/></w:pPr></w:lvl>`,
      )
      .join('');
  return `${XML_HEAD}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>${extra.join('')}</w:numbering>`;
}

const FOOTER = `${XML_HEAD}<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

const SETTINGS = `${XML_HEAD}<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

export function makeDocx(doc: readonly Block[], options: DocxOptions = {}): Buffer {
  const page = PAGE_TWIPS[options.size ?? 'A4'];
  const { w, h } = options.landscape ? { w: page.h, h: page.w } : page;
  const writer = new Writer(options, (w - 2 * MARGIN) * 635);
  const title = options.title?.trim();
  const titled = title && !(doc[0]?.type === 'heading' && doc[0].level === 1);
  const body =
    (titled
      ? writer.para('Title', `<w:r><w:t xml:space="preserve">${x(title)}</w:t></w:r>`) +
        (options.subtitle
          ? writer.para(
              'Subtitle',
              `<w:r><w:t xml:space="preserve">${x(options.subtitle)}</w:t></w:r>`,
            )
          : '')
      : '') + writer.blocks(doc);
  const footer = writer.rid(REL.footer, 'footer1.xml');
  const document = `${XML_HEAD}<w:document ${NS}><w:body>${body || '<w:p/>'}<w:sectPr><w:footerReference w:type="default" r:id="${footer}"/><w:pgSz w:w="${w}" w:h="${h}"${options.landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="708" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const images = [...new Set(writer.media.map((m) => m.path.split('.').pop() ?? 'png'))];
  return pack([
    {
      path: '[Content_Types].xml',
      data: contentTypes(
        [
          {
            part: '/word/document.xml',
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
          },
          {
            part: '/word/styles.xml',
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
          },
          {
            part: '/word/numbering.xml',
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
          },
          {
            part: '/word/settings.xml',
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
          },
          {
            part: '/word/footer1.xml',
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
          },
          {
            part: '/docProps/core.xml',
            type: 'application/vnd.openxmlformats-package.core-properties+xml',
          },
          {
            part: '/docProps/app.xml',
            type: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
          },
        ],
        images,
      ),
    },
    {
      path: '_rels/.rels',
      data: rels([
        { id: 'rId1', type: REL.officeDocument, target: 'word/document.xml' },
        { id: 'rId2', type: REL.core, target: 'docProps/core.xml' },
        { id: 'rId3', type: REL.app, target: 'docProps/app.xml' },
      ]),
    },
    { path: 'docProps/core.xml', data: coreProps(title) },
    { path: 'docProps/app.xml', data: appProps() },
    { path: 'word/document.xml', data: document },
    { path: 'word/styles.xml', data: styles(accentOf(options.accent)) },
    { path: 'word/numbering.xml', data: numbering(writer.nums) },
    { path: 'word/settings.xml', data: SETTINGS },
    { path: 'word/footer1.xml', data: FOOTER },
    {
      path: 'word/_rels/document.xml.rels',
      data: rels([
        { id: 'rId1', type: REL.styles, target: 'styles.xml' },
        { id: 'rId2', type: REL.numbering, target: 'numbering.xml' },
        { id: 'rId3', type: REL.settings, target: 'settings.xml' },
        ...writer.rels,
      ]),
    },
    ...writer.media,
  ]);
}
