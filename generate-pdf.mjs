#!/usr/bin/env node
import { chromium } from 'playwright';
import { readFile } from 'fs/promises';
import { resolve, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFile } from 'fs/promises';
const __dirname = dirname(fileURLToPath(import.meta.url));

function parseMd(md) {
  const lines = md.split('\n');
  const data = { name: '', subtitle: '', contact: {}, summary: '', experience: [], projects: [], skills: {}, education: [] };
  let section = null, currentJob = null, currentProject = null;
  const flushJob = () => { if (currentJob) { data.experience.push(currentJob); currentJob = null; } };
  const flushProject = () => { if (currentProject) { data.projects.push(currentProject); currentProject = null; } };
  for (const line of lines) {
    const t = line.trim();
    if (/^# /.test(t)) { data.name = t.replace(/^# /, ''); continue; }
    if (!section && data.name && !/^## /.test(t) && t) {
      if (t.includes('|') || t.includes('@')) {
        const parts = t.split('|').map(p => p.trim());
        let si = 0;
        if (!parts[0].includes('@') && !parts[0].startsWith('+') && !parts[0].includes('linkedin') && !parts[0].includes('github') && !parts[0].match(/^\w+,/)) { data.subtitle = t; si = 1; }
        for (let j = si; j < parts.length; j++) {
          const p = parts[j];
          if (p.includes('@')) data.contact.email = p;
          else if (p.startsWith('+') || /^\d/.test(p)) data.contact.phone = p;
          else if (p.includes('linkedin')) data.contact.linkedin = p;
          else if (p.includes('github')) data.contact.github = p;
          else if (p.match(/[A-Z][a-z]+,?\s+India/)) data.contact.location = p;
          else if (!data.contact.location) data.contact.location = p;
        }
      } else if (!data.subtitle) { data.subtitle = t; }
      continue;
    }
    if (/^## /.test(t)) {
      flushJob();
      flushProject();
      const rawSec = t.replace(/^## /, '').toLowerCase().trim();
      if (rawSec.includes('skills')) section = 'skills';
      else if (rawSec.includes('project')) section = 'projects';
      else if (rawSec.includes('experience')) section = 'experience';
      else if (rawSec.includes('summary')) section = 'summary';
      else if (rawSec.includes('education')) section = 'education';
      else section = rawSec;
      continue;
    }
    if (section === 'experience') {
      const rm = t.match(/^\*\*(.+?)\*\*\s*\|\s*(.+)/);
      if (rm) {
        flushJob();
        const role = rm[1].trim();
        const rest = rm[2].trim();
        const parts = rest.split('|').map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          currentJob = { company: parts[0], role: role, period: parts[1], bullets: [] };
        } else {
          currentJob = { company: currentJob ? currentJob.company : '', role: role, period: parts[0] || '', bullets: [] };
        }
        continue;
      }
      if (/^### /.test(t)) {
        flushJob();
        currentJob = { company: t.replace(/^### /, ''), role: '', period: '', bullets: [] };
        continue;
      }
      if (currentJob) {
        if (t.startsWith('- ')) { currentJob.bullets.push(t.replace(/^- /, '')); continue; }
        if (t.startsWith('▸ ')) { currentJob.bullets.push(t.replace(/^▸ /, '')); continue; }
        if (t.startsWith('▸')) { currentJob.bullets.push(t.replace(/^▸/, '').trim()); continue; }
      }
    }
    if (section === 'summary' && t) { data.summary += (data.summary ? ' ' : '') + t; continue; }
    if (section === 'projects') {
      if (t.startsWith('- **')) {
        flushProject();
        const tm = t.match(/^- \*\*(.+?)\*\*\s*(?:\(([^)]+)\))?\s*(?:\|\s*(.+))?/);
        if (tm) currentProject = { title: tm[1], period: tm[2] || '', link: tm[3] || '', bullets: [] };
        continue;
      }
      if (t.startsWith('- ') && currentProject) { currentProject.bullets.push(t.replace(/^- /, '')); continue; }
      if (t.startsWith('▸ ') && currentProject) { currentProject.bullets.push(t.replace(/^▸ /, '')); continue; }
      if (t.startsWith('▸') && currentProject) { currentProject.bullets.push(t.replace(/^▸/, '').trim()); continue; }
    }
    if (section === 'skills') { const sm = t.match(/^[-*]?\s*\*\*(.+?):\*\*\s*(.+)/); if (sm) data.skills[sm[1].trim()] = sm[2].trim(); continue; }
    if (section === 'education') {
      const em = t.match(/^[-*]?\s*\*\*(.+?)\*\*\s*\|\s*([^|]+)(?:\s*\|\s*(.+))?$/);
      if (em) {
        data.education.push({
          degree: em[1].trim(),
          org: em[2].trim(),
          year: em[3] ? em[3].trim() : ''
        });
      }
      continue;
    }
  }
  flushJob(); flushProject();
  return data;
}

const boldify = t => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

function buildExperience(jobs) {
  return jobs.map(j => `
    <div class="job">
      <div class="job-header">
        <span class="job-title-company">${j.role}<span class="separator">|</span>${j.company}</span>
        <span class="job-date">${j.period}</span>
      </div>
      <ul class="job-bullets">${j.bullets.map(b => `<li>${boldify(b)}</li>`).join('')}</ul>
    </div>`).join('');
}

function buildProjects(projects) {
  return projects.map(p => `
    <div class="project">
      <div class="project-header">
        <span class="project-name">${p.title}</span>
        <span class="job-date">${p.period}</span>
      </div>
      ${p.link ? `<a class="project-link" href="https://${p.link}">${p.link}</a>` : ''}
      <ul class="job-bullets">${p.bullets.map(b => `<li>${boldify(b)}</li>`).join('')}</ul>
    </div>`).join('');
}

function buildSkills(skills) {
  return `<div class="skills-block">${Object.entries(skills).map(([cat, items]) =>
    `<div class="skill-row"><span class="skill-label">${cat}</span><span class="skill-value">${boldify(items)}</span></div>`
  ).join('')}</div>`;
}

function buildEducation(edu) {
  return edu.map(e => {
    const orgPart = e.org ? ` — ${e.org}` : '';
    const yearPart = e.year ? e.year : '';
    return `
    <div class="edu-row">
      <span><span class="edu-degree">${e.degree}</span><span class="edu-school">${orgPart}</span></span>
      <span class="edu-year">${yearPart}</span>
    </div>`;
  }).join('');
}

function fillTemplate(template, data) {
  return template
    .replace('{{NAME}}', data.name)
    .replace('{{SUBTITLE}}', data.subtitle)
    .replace('{{EMAIL}}', data.contact.email || '')
    .replace('{{EMAIL}}', data.contact.email || '')
    .replace('{{PHONE}}', data.contact.phone || '')
    .replace('{{LOCATION}}', data.contact.location || '')
    .replace('{{LINKEDIN_URL}}', `https://${data.contact.linkedin || ''}`)
    .replace('{{LINKEDIN_DISPLAY}}', data.contact.linkedin || '')
    .replace('{{PORTFOLIO_URL}}', `https://${data.contact.github || ''}`)
    .replace('{{PORTFOLIO_DISPLAY}}', data.contact.github || '')
    .replace('{{SECTION_SUMMARY}}', 'Professional Summary')
    .replace('{{SUMMARY_TEXT}}', boldify(data.summary))
    .replace('{{SECTION_SKILLS}}', 'Technical Skills')
    .replace('{{SKILLS}}', buildSkills(data.skills))
    .replace('{{SECTION_EXPERIENCE}}', 'Professional Experience')
    .replace('{{EXPERIENCE}}', buildExperience(data.experience))
    .replace('{{SECTION_PROJECTS}}', 'Independent Project')
    .replace('{{PROJECTS}}', buildProjects(data.projects))
    .replace('{{SECTION_EDUCATION}}', 'Education')
    .replace('{{EDUCATION}}', buildEducation(data.education));
}

async function generatePDF() {
  const args = process.argv.slice(2);
  let inputPath, outputPath, templatePath, format = 'a4';
  for (const arg of args) {
    if (arg.startsWith('--format=')) format = arg.split('=')[1].toLowerCase();
    else if (arg.startsWith('--template=')) templatePath = arg.split('=')[1];
    else if (!inputPath) inputPath = arg;
    else if (!outputPath) outputPath = arg;
  }
  if (!inputPath || !outputPath) { console.error('Usage: node generate-pdf.mjs <input.html|input.md> <output.pdf>'); process.exit(1); }
  const resolvedInput = resolve(inputPath);
  const resolvedOutput = resolve(outputPath);
  const ext = extname(resolvedInput).toLowerCase();
  let htmlContent;
  if (ext === '.md') {
    const mdContent = await readFile(resolvedInput, 'utf-8');
    const data = parseMd(mdContent);

    // --- Programmatic Validation Against Source of Truth (cv.md) ---
    const sourceTruthPath = resolve(__dirname, 'cv.md');
    try {
      const sourceTruthMd = await readFile(sourceTruthPath, 'utf-8');
      const sourceTruth = parseMd(sourceTruthMd);

      // 1. Validate Independent Projects Preservation
      if (sourceTruth.projects && sourceTruth.projects.length > 0) {
        if (!data.projects || data.projects.length !== sourceTruth.projects.length) {
          console.error(`❌ Validation Failure: The tailored resume has modified the number of projects. Expected ${sourceTruth.projects.length}, got ${data.projects?.length || 0}.`);
          process.exit(1);
        }
        for (let i = 0; i < sourceTruth.projects.length; i++) {
          const sp = sourceTruth.projects[i];
          const dp = data.projects[i];
          if (dp.title !== sp.title) {
            console.error(`❌ Validation Failure: Project title mismatch at index ${i}. Expected "${sp.title}", got "${dp.title}".`);
            process.exit(1);
          }
          if (dp.bullets.length !== sp.bullets.length) {
            console.error(`❌ Validation Failure: Project "${sp.title}" has bullet count mismatch. Expected ${sp.bullets.length} bullets, got ${dp.bullets.length}.`);
            process.exit(1);
          }
          for (let j = 0; j < sp.bullets.length; j++) {
            const clean = b => b.replace(/\*/g, '').trim();
            if (clean(dp.bullets[j]) !== clean(sp.bullets[j])) {
              console.error(`❌ Validation Failure: Project "${sp.title}" bullet ${j + 1} mismatch.\nExpected: "${sp.bullets[j]}"\nGot:      "${dp.bullets[j]}"`);
              process.exit(1);
            }
          }
        }
      }

      // 2. Validate Education Entries (degrees must match)
      if (sourceTruth.education && sourceTruth.education.length > 0) {
        if (!data.education || data.education.length !== sourceTruth.education.length) {
          console.error(`❌ Validation Failure: Education entries count mismatch. Expected ${sourceTruth.education.length}, got ${data.education?.length || 0}.`);
          process.exit(1);
        }
        for (let i = 0; i < sourceTruth.education.length; i++) {
          const se = sourceTruth.education[i];
          const de = data.education[i];
          if (de.degree.trim() !== se.degree.trim()) {
            console.error(`❌ Validation Failure: Education entry ${i + 1} degree mismatch. Expected "${se.degree}", got "${de.degree}".`);
            process.exit(1);
          }
        }
      }
    } catch (err) {
      if (err.message.includes('Validation Failure')) throw err;
      console.warn("⚠️  Warning: cv.md not found or failed to parse for verification, skipping validation check.");
    }

    console.log(data.projects);
    console.log("SUBTITLE:", data.subtitle);
    const tmplPath = templatePath ? resolve(templatePath) : resolve(__dirname, 'cv-template.html');
    let template;
    try { template = await readFile(tmplPath, 'utf-8'); }
    catch { console.error(`Template not found at ${tmplPath}`); process.exit(1); }
    htmlContent = fillTemplate(template, data);
    await writeFile(
      resolvedOutput.replace('.pdf', '.html'),
      htmlContent,
      'utf8'
    );
  } else {
    htmlContent = await readFile(resolvedInput, 'utf-8');
  }

  // --- Global HTML Output Validation ---
  const requiredName = "Vinay B";
  if (!htmlContent.includes(requiredName)) {
    console.error(`❌ Validation Failure: Candidate name "${requiredName}" is missing or altered in HTML.`);
    process.exit(1);
  }

  const exactHeadline = "DevOps Engineer | Platform Engineering | SRE | MLOps | AIOps |";
  const normStr = s => s.replace(/\s+/g, '').replace(/\*/g, '').toLowerCase();
  if (!normStr(htmlContent).includes(normStr(exactHeadline))) {
    console.error(`❌ Validation Failure: Headline must match "${exactHeadline}" exactly.`);
    process.exit(1);
  }

  if (!htmlContent.includes("DevOps Engineer")) {
    console.error("❌ Validation Failure: Job title 'DevOps Engineer' is missing or altered.");
    process.exit(1);
  }
  if (!htmlContent.includes("Software Engineer")) {
    console.error("❌ Validation Failure: Job title 'Software Engineer' is missing or altered.");
    process.exit(1);
  }

  const requiredSkills = ["Cloud & Infra", "Kubernetes", "Observability", "CI/CD & Security", "Languages", "MLOps / AIOps", "AI-Native Tooling"];
  for (const skill of requiredSkills) {
    if (!htmlContent.includes(skill)) {
      console.error(`❌ Validation Failure: Required skill category "${skill}" is missing or altered.`);
      process.exit(1);
    }
  }

  const projectTitle = "Dual-Engine MLOps + AIOps Platform";
  if (!htmlContent.includes(projectTitle)) {
    console.error(`❌ Validation Failure: Project title "${projectTitle}" is missing or altered.`);
    process.exit(1);
  }

  const jobCount = (htmlContent.match(/class="job"/g) || []).length;
  if (jobCount < 2) {
    console.error(`❌ Validation Failure: Experience section has fewer than 2 jobs. Got ${jobCount}.`);
    process.exit(1);
  }

  const projectCount = (htmlContent.match(/class="project"/g) || []).length;
  if (projectCount < 1) {
    console.error(`❌ Validation Failure: Projects section has fewer than 1 project. Got ${projectCount}.`);
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle' });
  await page.pdf({ path: resolvedOutput, format: format === 'letter' ? 'Letter' : 'A4', printBackground: true, margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' } });
  await browser.close();
  console.log(`PDF generated: ${resolvedOutput}`);
}
generatePDF().catch(err => { console.error('Error:', err); process.exit(1); });
