export interface TabContext {
  url: string;
  company_name: string | null;
  role_title: string | null;
  job_board: string | null;
}

export async function getActiveTabContext(): Promise<TabContext> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const url = tab?.url || "";
  const title = tab?.title || "";

  const job_board = detectJobBoard(url);
  const { company, role } = parseTitleForCompanyAndRole(title, job_board);

  return { url, company_name: company, role_title: role, job_board };
}

const JOB_BOARD_MAP: [string, string][] = [
  ["greenhouse.io", "greenhouse"],
  ["lever.co", "lever"],
  ["myworkdayjobs.com", "workday"],
  ["myworkday.com", "workday"],
  ["icims.com", "icims"],
  ["smartrecruiters.com", "smartrecruiters"],
  ["ashbyhq.com", "ashby"],
  ["bamboohr.com", "bamboohr"],
  ["jazzhr.com", "jazzhr"],
  ["taleo.net", "taleo"],
  ["successfactors.com", "successfactors"],
  ["successfactors.eu", "successfactors"],
  ["linkedin.com", "linkedin"],
  ["indeed.com", "indeed"],
  ["glassdoor.com", "glassdoor"],
  ["jobvite.com", "jobvite"],
];

export function detectJobBoard(url: string): string | null {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const [domain, board] of JOB_BOARD_MAP) {
      if (hostname.includes(domain)) return board;
    }
    return null;
  } catch {
    return null;
  }
}

const ATS_SUFFIX_RE =
  /\s*[|\-–—]\s*(Greenhouse|Lever|Workday|LinkedIn|Indeed|SmartRecruiters|Ashby|BambooHR|JazzHR|Glassdoor|Jobvite|iCIMS|Taleo).*$/i;

export function parseTitleForCompanyAndRole(
  title: string,
  _jobBoard: string | null,
): { company: string | null; role: string | null } {
  if (!title.trim()) return { company: null, role: null };

  const cleaned = title.replace(ATS_SUFFIX_RE, "").trim();
  if (!cleaned) return { company: null, role: null };

  // " - " delimiter: role - company
  if (cleaned.includes(" - ")) {
    const [role, ...rest] = cleaned.split(" - ");
    const company = rest.join(" - ").trim();
    return {
      role: role.trim() || null,
      company: company || null,
    };
  }

  // " | " delimiter: role | company
  if (cleaned.includes(" | ")) {
    const [role, ...rest] = cleaned.split(" | ");
    const company = rest.join(" | ").trim();
    return {
      role: role.trim() || null,
      company: company || null,
    };
  }

  // " at " (case-insensitive): role at company
  const atMatch = cleaned.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) {
    return {
      role: atMatch[1].trim() || null,
      company: atMatch[2].trim() || null,
    };
  }

  // ": " delimiter: company: role
  if (cleaned.includes(": ")) {
    const [company, ...rest] = cleaned.split(": ");
    const role = rest.join(": ").trim();
    return {
      company: company.trim() || null,
      role: role || null,
    };
  }

  return { company: null, role: cleaned || null };
}
