export interface PendingApplication {
  local_id: string;
  portal_url: string;
  company_name: string | null;
  role_title: string | null;
  job_board: string | null;
  applied_at: string;
  status: "applied";

  job_id: number | null;
  resume_id: number | null;
  resume_filename: string | null;
  resume_source: string | null;
  cover_letter: string | null;
  salary: string | null;

  synced: boolean;
  backend_id: number | null;
  retry_count: number;
  last_error: string | null;
}
