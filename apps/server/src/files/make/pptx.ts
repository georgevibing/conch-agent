/**
 * Slides as a PowerPoint deck (`.pptx`, 16:9): a title slide, section
 * slides and content slides with bullets (nested, with bold and italics),
 * a picture from the chat beside them, speaker-free, numbered. Opens in
 * PowerPoint, Keynote, Google Slides and LibreOffice.
 */
import { fromMarkdown, runsText, type Block, type Run } from './blocks';
import { accentOf } from './html';
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

export interface Slide {
  /** `title`: the opening slide; `section`: a divider; `content` (default): a title and points. */
  layout?: 'title' | 'section' | 'content';
  title: string;
  subtitle?: string;
  /** Points, each Markdown inline (bold, italics, code, links). */
  bullets?: string[];
  /** Markdown for the body instead of (or after) bullets: paragraphs and nested lists. */
  body?: string;
  /** A picture from the chat (`att_…`) beside the points. */
  image?: string;
}

const W = 12_192_000;
const H = 6_858_000;
const MARGIN = 640_080; // 0.7"
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

interface Line {
  runs: Run[];
  level: number;
  bullet: boolean;
}

function lines(slide: Slide): Line[] {
  const out: Line[] = [];
  for (const bullet of slide.bullets ?? []) {
    const doc = fromMarkdown(bullet);
    const first = doc[0];
    const runs =
      first?.type === 'paragraph' || first?.type === 'heading' ? first.runs : [{ text: bullet }];
    out.push({ runs, level: 0, bullet: true });
  }
  const walk = (blocks: readonly Block[], level: number) => {
    for (const block of blocks) {
      if (block.type === 'paragraph' || block.type === 'heading')
        out.push({ runs: block.runs, level, bullet: false });
      else if (block.type === 'list')
        for (const item of block.items) {
          out.push({ runs: item.runs, level, bullet: true });
          walk(item.children, level + 1);
        }
      else if (block.type === 'quote') walk(block.blocks, level);
      else if (block.type === 'code')
        for (const line of block.text.split('\n'))
          out.push({ runs: [{ text: line, code: true }], level, bullet: false });
      else if (block.type === 'table')
        for (const row of [block.header, ...block.rows])
          out.push({ runs: [{ text: row.map(runsText).join('  ·  ') }], level, bullet: true });
    }
  };
  if (slide.body) walk(fromMarkdown(slide.body), 0);
  return out;
}

function textRuns(runs: readonly Run[], size: number, color: string, accent: string): string {
  const parts = runs
    .filter((r) => r.text || r.br)
    .map((run) => {
      if (run.br) return '<a:br/>';
      const attrs = [
        'lang="en-US"',
        `sz="${size * 100}"`,
        run.bold ? 'b="1"' : '',
        run.italic ? 'i="1"' : '',
        run.strike ? 'strike="sngStrike"' : '',
        'dirty="0"',
      ]
        .filter(Boolean)
        .join(' ');
      const fill = `<a:solidFill><a:srgbClr val="${run.link ? accent : color}"/></a:solidFill>`;
      const font = run.code ? '<a:latin typeface="Consolas"/><a:cs typeface="Consolas"/>' : '';
      return `<a:r><a:rPr ${attrs}>${fill}${font}</a:rPr><a:t>${x(run.text)}</a:t></a:r>`;
    });
  return parts.join('');
}

function textBox(
  id: number,
  name: string,
  box: { x: number; y: number; w: number; h: number },
  paragraphs: string,
  options: { anchor?: 't' | 'ctr' | 'b'; ph?: string } = {},
) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${x(name)}"/><p:cNvSpPr${options.ph ? '><a:spLocks noGrp="1"/></p:cNvSpPr>' : ' txBox="1"/>'}<p:nvPr>${options.ph ?? ''}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.w}" cy="${box.h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${options.anchor ?? 't'}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function rect(id: number, box: { x: number; y: number; w: number; h: number }, color: string) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Accent ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.w}" cy="${box.h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
}

const GROUP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function para(content: string, options: { align?: string; space?: number } = {}) {
  return `<a:p><a:pPr${options.align ? ` algn="${options.align}"` : ''}>${options.space ? `<a:spcBef><a:spcPts val="${options.space}"/></a:spcBef>` : ''}<a:buNone/></a:pPr>${content}</a:p>`;
}

function slideXml(
  slide: Slide,
  index: number,
  accent: string,
  picture: { rid: string; picture: Picture } | undefined,
): string {
  const ink = '1D2329';
  const soft = '59636E';
  const shapes: string[] = [];
  let id = 2;
  const layout =
    slide.layout ?? (index === 0 && !slide.bullets?.length && !slide.body ? 'title' : 'content');
  const title = textRuns(
    [{ text: slide.title }],
    layout === 'content' ? 30 : layout === 'title' ? 44 : 36,
    ink,
    accent,
  );
  if (layout === 'title' || layout === 'section') {
    const top = layout === 'title' ? 2_286_000 : 2_743_200;
    shapes.push(rect(id++, { x: MARGIN, y: top - 228_600, w: 914_400, h: 54_864 }, accent));
    shapes.push(
      textBox(id++, 'Title', { x: MARGIN, y: top, w: W - 2 * MARGIN, h: 1_371_600 }, para(title), {
        anchor: 't',
        ph: '<p:ph type="title"/>',
      }),
    );
    if (slide.subtitle)
      shapes.push(
        textBox(
          id++,
          'Subtitle',
          { x: MARGIN, y: top + 1_463_040, w: W - 2 * MARGIN, h: 914_400 },
          para(textRuns([{ text: slide.subtitle }], 20, soft, accent)),
        ),
      );
  } else {
    shapes.push(rect(id++, { x: 0, y: 0, w: W, h: 73_152 }, accent));
    shapes.push(
      textBox(
        id++,
        'Title',
        { x: MARGIN, y: 411_480, w: W - 2 * MARGIN, h: 868_680 },
        para(title),
        {
          anchor: 'b',
          ph: '<p:ph type="title"/>',
        },
      ),
    );
    const body = lines(slide);
    const size = body.length <= 5 ? 22 : body.length <= 8 ? 19 : body.length <= 12 ? 16 : 14;
    const bodyWidth = picture ? Math.round((W - 2 * MARGIN) * 0.55) : W - 2 * MARGIN;
    const paragraphs = body
      .map((line) => {
        const indent = 342_900 * (line.level + 1);
        const bullet = line.bullet
          ? `<a:buClr><a:srgbClr val="${accent}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="${line.level ? '–' : '•'}"/>`
          : '<a:buNone/>';
        return `<a:p><a:pPr marL="${line.bullet ? indent : 342_900 * line.level}" indent="${line.bullet ? -342_900 : 0}"><a:lnSpc><a:spcPct val="110000"/></a:lnSpc><a:spcBef><a:spcPts val="${line.level ? 400 : 900}"/></a:spcBef>${bullet}</a:pPr>${textRuns(line.runs, line.level ? size - 2 : size, line.level ? soft : ink, accent) || `<a:endParaRPr lang="en-US" sz="${size * 100}" dirty="0"/>`}</a:p>`;
      })
      .join('');
    if (paragraphs)
      shapes.push(
        textBox(
          id++,
          'Content',
          { x: MARGIN, y: 1_463_040, w: bodyWidth, h: H - 1_463_040 - 731_520 },
          paragraphs,
          { ph: '<p:ph idx="1"/>' },
        ),
      );
    if (picture) {
      const boxW = W - 2 * MARGIN - bodyWidth - 365_760;
      const boxH = H - 1_463_040 - 731_520;
      const { cx, cy } = fit(picture.picture, boxW, boxH);
      const px = W - MARGIN - boxW + Math.round((boxW - cx) / 2);
      const py = 1_463_040 + Math.round((boxH - cy) / 2);
      const alt = x(picture.picture.alt ?? slide.title);
      shapes.push(
        `<p:pic><p:nvPicPr><p:cNvPr id="${id++}" name="Picture" descr="${alt}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${picture.rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${px}" y="${py}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
      );
    }
  }
  // The slide's number, bottom right.
  shapes.push(
    textBox(
      id++,
      'Slide number',
      { x: W - MARGIN - 914_400, y: H - 548_640, w: 914_400, h: 320_040 },
      `<a:p><a:pPr algn="r"><a:buNone/></a:pPr><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-US" sz="1100" dirty="0"><a:solidFill><a:srgbClr val="8A939C"/></a:solidFill></a:rPr><a:t>${index + 1}</a:t></a:fld></a:p>`,
    ),
  );
  return `${XML_HEAD}<p:sld ${NS}><p:cSld><p:spTree>${GROUP}${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function theme(accent: string) {
  const clr = (name: string, value: string) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`;
  const fill3 = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  return `${XML_HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Conch"><a:themeElements><a:clrScheme name="Conch"><a:dk1><a:srgbClr val="1D2329"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>${clr('dk2', '2B3440')}${clr('lt2', 'F4F6F8')}${clr('accent1', accent)}${clr('accent2', 'D97706')}${clr('accent3', '059669')}${clr('accent4', '7C3AED')}${clr('accent5', 'DB2777')}${clr('accent6', '0891B2')}${clr('hlink', accent)}${clr('folHlink', '6B21A8')}</a:clrScheme><a:fontScheme name="Conch"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Conch"><a:fillStyleLst>${fill3}${fill3}${fill3}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fill3}${fill3}${fill3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

const LEVEL = (sz: number, bullet: boolean) =>
  `<a:lvl1pPr marL="${bullet ? 342900 : 0}" indent="${bullet ? -342900 : 0}" algn="l">${bullet ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : '<a:buNone/>'}<a:defRPr sz="${sz}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>`;

const MASTER = `${XML_HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${MARGIN}" y="411480"/><a:ext cx="${W - 2 * MARGIN}" cy="868680"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr anchor="b"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Text Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${MARGIN}" y="1463040"/><a:ext cx="${W - 2 * MARGIN}" cy="${H - 1463040 - 731520}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200" b="1" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>${LEVEL(2000, true)}</p:bodyStyle><p:otherStyle>${LEVEL(1800, false)}</p:otherStyle></p:txStyles></p:sldMaster>`;

const LAYOUT = `${XML_HEAD}<p:sldLayout ${NS} type="obj" preserve="1"><p:cSld name="Title and Content"><p:spTree>${GROUP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

export function makePptx(
  slides: readonly Slide[],
  options: { title?: string; accent?: string; pictures?: ReadonlyMap<string, Picture> } = {},
): Buffer {
  const accent = accentOf(options.accent).slice(1).toUpperCase();
  const media: Part[] = [];
  const mediaFor = new Map<string, string>();
  const slideParts: Part[] = [];
  slides.forEach((slide, i) => {
    const picture = slide.image ? options.pictures?.get(slide.image) : undefined;
    let found: { rid: string; picture: Picture } | undefined;
    const slideRels: { id: string; type: string; target: string }[] = [
      { id: 'rId1', type: REL.slideLayout, target: '../slideLayouts/slideLayout1.xml' },
    ];
    if (picture && slide.image) {
      let target = mediaFor.get(slide.image);
      if (!target) {
        target = `media/image${media.length + 1}.${EXT[picture.mimeType]}`;
        media.push({ path: `ppt/${target}`, data: picture.bytes });
        mediaFor.set(slide.image, target);
      }
      slideRels.push({ id: 'rId2', type: REL.image, target: `../${target}` });
      found = { rid: 'rId2', picture };
    }
    slideParts.push(
      { path: `ppt/slides/slide${i + 1}.xml`, data: slideXml(slide, i, accent, found) },
      { path: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: rels(slideRels) },
    );
  });
  const n = slides.length;
  const presentation = `${XML_HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`)
    .join(
      '',
    )}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const images = [...new Set(media.map((m) => m.path.split('.').pop() ?? 'png'))];
  return pack([
    {
      path: '[Content_Types].xml',
      data: contentTypes(
        [
          {
            part: '/ppt/presentation.xml',
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
          },
          {
            part: '/ppt/slideMasters/slideMaster1.xml',
            type: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
          },
          {
            part: '/ppt/slideLayouts/slideLayout1.xml',
            type: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
          },
          ...slides.map((_, i) => ({
            part: `/ppt/slides/slide${i + 1}.xml`,
            type: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
          })),
          {
            part: '/ppt/theme/theme1.xml',
            type: 'application/vnd.openxmlformats-officedocument.theme+xml',
          },
          {
            part: '/ppt/presProps.xml',
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
          },
          {
            part: '/ppt/viewProps.xml',
            type: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
          },
          {
            part: '/ppt/tableStyles.xml',
            type: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
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
        { id: 'rId1', type: REL.officeDocument, target: 'ppt/presentation.xml' },
        { id: 'rId2', type: REL.core, target: 'docProps/core.xml' },
        { id: 'rId3', type: REL.app, target: 'docProps/app.xml' },
      ]),
    },
    { path: 'docProps/core.xml', data: coreProps(options.title ?? slides[0]?.title) },
    {
      path: 'docProps/app.xml',
      data: appProps(`<Slides>${n}</Slides><PresentationFormat>Widescreen</PresentationFormat>`),
    },
    { path: 'ppt/presentation.xml', data: presentation },
    {
      path: 'ppt/_rels/presentation.xml.rels',
      data: rels([
        { id: 'rId1', type: REL.slideMaster, target: 'slideMasters/slideMaster1.xml' },
        ...slides.map((_, i) => ({
          id: `rId${i + 2}`,
          type: REL.slide,
          target: `slides/slide${i + 1}.xml`,
        })),
        { id: `rId${n + 2}`, type: REL.presProps, target: 'presProps.xml' },
        { id: `rId${n + 3}`, type: REL.viewProps, target: 'viewProps.xml' },
        { id: `rId${n + 4}`, type: REL.theme, target: 'theme/theme1.xml' },
        { id: `rId${n + 5}`, type: REL.tableStyles, target: 'tableStyles.xml' },
      ]),
    },
    { path: 'ppt/slideMasters/slideMaster1.xml', data: MASTER },
    {
      path: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: rels([
        { id: 'rId1', type: REL.slideLayout, target: '../slideLayouts/slideLayout1.xml' },
        { id: 'rId2', type: REL.theme, target: '../theme/theme1.xml' },
      ]),
    },
    { path: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT },
    {
      path: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: rels([
        { id: 'rId1', type: REL.slideMaster, target: '../slideMasters/slideMaster1.xml' },
      ]),
    },
    { path: 'ppt/theme/theme1.xml', data: theme(accent) },
    {
      path: 'ppt/presProps.xml',
      data: `${XML_HEAD}<p:presentationPr ${NS}/>`,
    },
    {
      path: 'ppt/viewProps.xml',
      data: `${XML_HEAD}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`,
    },
    {
      path: 'ppt/tableStyles.xml',
      data: `${XML_HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
    },
    ...slideParts,
    ...media,
  ]);
}

/** One slide drawn as HTML (for a preview picture), 1280×720. */
export function slideHtml(slide: Slide, index: number, accentHex?: string): string {
  const accent = accentOf(accentHex);
  const esc = (t: string) =>
    t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const layout =
    slide.layout ?? (index === 0 && !slide.bullets?.length && !slide.body ? 'title' : 'content');
  const body = lines(slide)
    .slice(0, 14)
    .map(
      (l) =>
        `<li style="margin-left:${l.level * 28}px;${l.bullet ? '' : 'list-style:none;'}${l.level ? 'color:#59636e;font-size:0.9em;' : ''}">${esc(runsText(l.runs))}</li>`,
    )
    .join('');
  const main =
    layout === 'content'
      ? `<div style="position:absolute;inset:0 0 auto 0;height:8px;background:${accent}"></div><h1 style="position:absolute;left:67px;right:67px;top:43px;height:91px;display:flex;align-items:flex-end;margin:0;font-size:34px">${esc(slide.title)}</h1><ul style="position:absolute;left:67px;right:67px;top:160px;margin:0;padding-left:28px;font-size:${lines(slide).length <= 5 ? 26 : 20}px;line-height:1.35">${body}</ul>`
      : `<div style="position:absolute;left:67px;top:${layout === 'title' ? 216 : 264}px;width:96px;height:6px;background:${accent}"></div><h1 style="position:absolute;left:67px;right:67px;top:${layout === 'title' ? 240 : 288}px;margin:0;font-size:${layout === 'title' ? 52 : 42}px;line-height:1.1">${esc(slide.title)}</h1>${slide.subtitle ? `<p style="position:absolute;left:67px;right:67px;top:${layout === 'title' ? 400 : 440}px;margin:0;font-size:24px;color:#59636e">${esc(slide.subtitle)}</p>` : ''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1280px;height:720px;background:#fff;color:#1d2329;font-family:Calibri,Carlito,"Segoe UI",-apple-system,Helvetica,Arial,sans-serif;overflow:hidden}ul li{margin:10px 0}ul li::marker{color:${accent}}</style></head><body><div style="position:relative;width:1280px;height:720px">${main}</div></body></html>`;
}
