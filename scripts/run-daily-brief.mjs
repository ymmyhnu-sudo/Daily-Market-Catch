import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUTPUT_DIR = path.join(ROOT, "outputs");
const PROMPT_PATH = path.join(ROOT, "prompts", "daily_combined_brief.md");
const WATCHLIST_PATH = path.join(ROOT, "config", "watchlists.json");

const {
  OPENAI_API_KEY,
  FEISHU_WEBHOOK_URL,
  OPENAI_BASE_URL = "https://api.openai.com/v1",
  OPENAI_MODEL = "gpt-5-mini",
} = process.env;

if (!OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

if (!FEISHU_WEBHOOK_URL) {
  throw new Error("Missing FEISHU_WEBHOOK_URL");
}

function getDateLabel(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function buildWatchlistSection(config) {
  const hk = config.hongKong
    .map((item) => `- ${item.ticker}｜${item.name}｜优先级 ${item.priority}｜主题 ${item.theme}`)
    .join("\n");
  const us = config.us
    .map((item) => `- ${item.ticker}｜${item.name}｜优先级 ${item.priority}｜主题 ${item.theme}`)
    .join("\n");

  return `用户关注名单：\n\n港股：\n${hk}\n\n美股：\n${us}\n\n重点主题：${config.focusThemes.join("、")}`;
}

function extractTextFromResponse(json) {
  if (typeof json.output_text === "string" && json.output_text.trim()) {
    return json.output_text.trim();
  }

  const output = Array.isArray(json.output) ? json.output : [];
  const parts = [];

  for (const item of output) {
    if (item.type !== "message") continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (block.type === "output_text" && block.text) {
        parts.push(block.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function extractSummary(markdown) {
  const lines = markdown.split("\n");
  let inSection = false;
  const collected = [];

  for (const line of lines) {
    if (/^##\s*(?:十、)?拟发送到飞书的简版文本/.test(line)) {
      inSection = true;
      continue;
    }

    if (inSection && /^##\s+/.test(line)) {
      break;
    }

    if (inSection) {
      collected.push(line);
    }
  }

  const summary = collected.join("\n").trim();
  if (summary) return summary;

  return lines.slice(0, 80).join("\n").trim();
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("insufficient_quota")) {
    return {
      kind: "openai_quota",
      summary: "OpenAI API quota exhausted or billing unavailable",
    };
  }

  if (message.includes("Missing OPENAI_API_KEY")) {
    return {
      kind: "missing_openai_key",
      summary: "OPENAI_API_KEY secret is missing",
    };
  }

  if (message.includes("Missing FEISHU_WEBHOOK_URL")) {
    return {
      kind: "missing_feishu_webhook",
      summary: "FEISHU_WEBHOOK_URL secret is missing",
    };
  }

  if (message.includes("Feishu webhook failed")) {
    return {
      kind: "feishu_webhook_error",
      summary: "Feishu webhook request failed",
    };
  }

  if (message.includes("OpenAI API error")) {
    return {
      kind: "openai_api_error",
      summary: "OpenAI API request failed",
    };
  }

  return {
    kind: "unexpected_error",
    summary: "Unexpected runtime error",
  };
}

async function writeRunStatus(outputDir, payload) {
  const statusPath = path.join(outputDir, "run-status.json");
  await fs.writeFile(statusPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function appendStepSummary(lines) {
  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (!stepSummary) return;
  await fs.appendFile(stepSummary, `${lines.join("\n")}\n`, "utf8");
}

async function callOpenAI(prompt, config) {
  const body = {
    model: OPENAI_MODEL,
    input: prompt,
    tools: [
      {
        type: "web_search",
        search_context_size: "medium",
        user_location: config.userLocation,
      },
    ],
  };

  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(`OpenAI API error ${response.status}: ${JSON.stringify(json)}`);
  }

  const text = extractTextFromResponse(json);
  if (!text) {
    throw new Error("OpenAI response did not include output text");
  }

  return { text, raw: json };
}

async function sendToFeishu(summary, outputFileName) {
  const now = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  const messageText = `港美股每日赚钱/亏钱机会一览\n\n发送时间：${now}\n来源文件：${outputFileName}\n\n${summary}`;

  const payload = {
    msg_type: "text",
    content: {
      text: messageText,
    },
  };

  const response = await fetch(FEISHU_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw new Error(`Feishu webhook failed: ${JSON.stringify(json)}`);
  }

  return json;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const config = JSON.parse(await fs.readFile(WATCHLIST_PATH, "utf8"));
  const promptTemplate = await fs.readFile(PROMPT_PATH, "utf8");
  const dateLabel = getDateLabel(config.timezone || "Asia/Shanghai");
  const outputFileName = `daily_combined_${dateLabel}.md`;
  const outputPath = path.join(OUTPUT_DIR, outputFileName);

  const prompt = [
    promptTemplate.replaceAll("{{DATE_LABEL}}", dateLabel),
    "",
    buildWatchlistSection(config),
  ].join("\n");

  console.log(`Generating report for ${dateLabel} with model ${OPENAI_MODEL}`);

  const { text, raw } = await callOpenAI(prompt, config);
  await fs.writeFile(outputPath, `${text.trim()}\n`, "utf8");

  const summary = extractSummary(text);
  await sendToFeishu(summary, outputFileName);

  const metaPath = path.join(OUTPUT_DIR, `daily_combined_${dateLabel}.meta.json`);
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        outputFileName,
        model: OPENAI_MODEL,
        createdAt: new Date().toISOString(),
        responseId: raw.id || null,
      },
      null,
      2
    ),
    "utf8"
  );

  await writeRunStatus(OUTPUT_DIR, {
    ok: true,
    stage: "completed",
    outputFileName,
    model: OPENAI_MODEL,
    createdAt: new Date().toISOString(),
    responseId: raw.id || null,
  });

  await appendStepSummary([
    `# Daily brief sent`,
    ``,
    `- File: \`${outputFileName}\``,
    `- Model: \`${OPENAI_MODEL}\``,
    `- Output: \`outputs/${outputFileName}\``,
  ]);
}

main().catch((error) => {
  (async () => {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const classified = classifyError(error);
    const message = error instanceof Error ? error.message : String(error);

    await writeRunStatus(OUTPUT_DIR, {
      ok: false,
      stage: classified.kind,
      summary: classified.summary,
      model: OPENAI_MODEL,
      createdAt: new Date().toISOString(),
      errorMessage: message,
    });

    await appendStepSummary([
      `# Daily brief failed`,
      ``,
      `- Stage: \`${classified.kind}\``,
      `- Summary: ${classified.summary}`,
      `- Model: \`${OPENAI_MODEL}\``,
      `- Error: \`${message}\``,
      `- Artifact: \`outputs/run-status.json\``,
    ]);
  })()
    .catch((summaryError) => {
      console.error("Failed to write run status", summaryError);
    })
    .finally(() => {
      console.error(error);
      process.exit(1);
    });
});
