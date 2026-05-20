require("dotenv").config();
const express = require("express");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/generate", upload.single("resume_pdf"), async (req, res) => {
  try {
    const { resume_text, job_description, company, role } = req.body;

    let resumeContent = resume_text?.trim() || "";

    if (req.file) {
      // pdf-parse has a known init bug in serverless — import from the lib path directly
      const pdf = require("pdf-parse/lib/pdf-parse");
      const pdfData = await pdf(req.file.buffer);
      resumeContent = pdfData.text.trim();
    }

    if (!resumeContent) {
      return res.status(400).json({ error: "Please provide a resume (upload PDF or paste text)." });
    }
    if (!job_description?.trim()) {
      return res.status(400).json({ error: "Job description is required." });
    }
    if (!company?.trim() || !role?.trim()) {
      return res.status(400).json({ error: "Company name and role title are required." });
    }

    const systemPrompt = `You are helping write a tailored cover letter. Follow this exact process:

STEP 1 — Research the company and role:
Using the company name and job description, identify:
- What the product does, who the customers are, and the specific problem it solves
- The operational workflow this role sits inside and where the candidate's work would actually fit
- The domain's constraints: is it high-stakes, compliance-heavy, latency-sensitive, messy-data-driven, or safety-critical? What breaks when things go wrong?
- The specific AI primitives mentioned (agents, RAG, fine-tuning, evals, vector DBs, orchestration) and the exact tech stack (frameworks, languages, tools, cloud)
- Company stage and culture, and the appropriate tone — direct and blunt for startups, formal for regulated industries, technical for engineering roles. Do not default to generic professional.

STEP 2 — Fit check before writing:
Honestly assess the resume against the role on three dimensions:
- Technical skills: which required tools, languages, or methods does the resume actually support? List what matches and what is missing.
- Domain/industry: does the candidate have relevant domain experience, or are they coming from a different field?
- Experience level: does the candidate meet the stated requirements (years of experience, degree type, specific certifications)?

If there are hard gaps — required skills completely absent, wrong degree field, missing years of experience — note them. Do not paper over them. The letter should be honest about what the candidate can and cannot offer.

STEP 3 — Select and map experiences:
Choose only the 2–3 experiences from the resume that genuinely connect to this role.
- The connection must be direct — one logical step, not two. "Built AI tutoring workflows" connects to "build AI features for customer workflows." "Sold consumer products" does not connect to "opto-electronic manufacturing" or "CAD prototyping."
- For each selected experience, surface only the tools or methods that map to the company's stated stack. Do not list everything the candidate knows.
- Non-engineering experiences (sales, operations, brand-building) get at most one sentence, focused on the single most transferable angle only.

STEP 4 — Write a cover letter under 320 words, organized around 2–3 fit themes.

STEP 5 — Revise: cut any sentence that could apply to any applicant at any company. Remove or replace any claim without concrete evidence.

WRITING RULES:
- Write in the tone chosen in Step 1.
- Connect experiences to the company's specific product context and customer workflow, not just the job requirements list.
- When the role involves AI agents, orchestration, or multi-step pipelines, address it directly — do not reduce it to "LLM integration."
- When the domain is high-stakes (finance, healthcare, legal, manufacturing), address reliability, edge cases, or failure modes — not just feature shipping.
- For every major claim, include one concrete detail: project name, action taken, tool used, measurable result, or stakeholder context.
- Mirror the company's stack only where the resume genuinely supports it. Do not claim or imply fluency in tools not present in the resume. If there is a partial match (e.g. candidate knows Python, role primarily uses Java), state what the candidate has and acknowledge the difference.
- Use confident but not presumptuous language. Do not tell the company how their own product or process works.
- Use concrete language: building, deploying, debugging, iterating with users, handling messy data, translating user needs into working features.
- Never write: "I am passionate about X", "excited to apply", "perfect fit", "AI-native", "end-to-end", "cross-functional", "stakeholder alignment", "operating in ambiguity", "rapid prototyping", "thrive in fast-paced environments."
- Mention the company and role by name. Do not flatter them.
- No subject line or email header. Start with "Dear Hiring Manager," or a role-specific salutation.
- End with one short, direct closing sentence.

OUTPUT FORMAT — respond with raw valid JSON only. No markdown, no code fences, no explanation outside the JSON object:
{
  "cover_letter": "the full cover letter text",
  "fit_warning": "If there are significant gaps — required skills completely absent, wrong degree field, insufficient years of experience, or domain experience that does not transfer — write 1–2 direct sentences naming the specific gaps. Be concrete: name the missing skill or requirement, not a vague disclaimer. If the fit is genuinely strong with no hard gaps, set this to null.",
  "targeting": "3 sentences: (1) tone chosen and why, (2) fit assessment — what genuinely matches and any significant gaps, (3) which experiences were selected and how their stack maps to the role"
}`;

    const userPrompt = `Resume:
${resumeContent}

Job Description:
${job_description.trim()}

Company: ${company.trim()}
Role: ${role.trim()}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    let coverLetter, fitWarning, targeting;
    try {
      const raw = message.content[0].text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      coverLetter = parsed.cover_letter?.trim();
      fitWarning = parsed.fit_warning && parsed.fit_warning !== "null" ? parsed.fit_warning.trim() : null;
      targeting = parsed.targeting?.trim();
    } catch {
      coverLetter = message.content[0].text.trim();
      fitWarning = null;
      targeting = null;
    }

    const wordCount = coverLetter.split(/\s+/).filter(Boolean).length;

    res.json({ cover_letter: coverLetter, fit_warning: fitWarning, targeting, word_count: wordCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to generate cover letter." });
  }
});

app.post("/extract-pdf", upload.single("resume_pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF file provided." });
    const pdf = require("pdf-parse/lib/pdf-parse");
    const pdfData = await pdf(req.file.buffer);
    res.json({ text: pdfData.text.trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to extract PDF text." });
  }
});

// Local dev only — Vercel handles listening itself
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Cover letter agent running at http://localhost:${PORT}`));
}

module.exports = app;
