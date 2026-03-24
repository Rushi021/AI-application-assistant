"""create initial schema

Revision ID: d0e1f2a3b4c5
Revises:
Create Date: 2026-03-24

"""

from alembic import op
import sqlalchemy as sa


revision = "d0e1f2a3b4c5"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=100), nullable=False),
        sa.Column("google_id", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("picture_url", sa.String(length=500), nullable=True),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("address_line1", sa.String(length=255), nullable=True),
        sa.Column("address_line2", sa.String(length=255), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=True),
        sa.Column("state", sa.String(length=100), nullable=True),
        sa.Column("zip_code", sa.String(length=20), nullable=True),
        sa.Column("country", sa.String(length=100), nullable=True),
        sa.Column("linkedin_url", sa.String(length=500), nullable=True),
        sa.Column("portfolio_url", sa.String(length=500), nullable=True),
        sa.Column("github_url", sa.String(length=500), nullable=True),
        sa.Column("years_of_experience", sa.Integer(), nullable=True),
        sa.Column("current_title", sa.String(length=255), nullable=True),
        sa.Column("current_company", sa.String(length=255), nullable=True),
        sa.Column("degree", sa.String(length=255), nullable=True),
        sa.Column("field_of_study", sa.String(length=255), nullable=True),
        sa.Column("university", sa.String(length=255), nullable=True),
        sa.Column("graduation_year", sa.Integer(), nullable=True),
        sa.Column("gpa", sa.Float(), nullable=True),
        sa.Column("visa_status", sa.String(length=100), nullable=True),
        sa.Column("work_authorization", sa.String(length=100), nullable=True),
        sa.Column("sponsorship_needed", sa.Boolean(), nullable=True),
        sa.Column("gender", sa.String(length=50), nullable=True),
        sa.Column("ethnicity", sa.String(length=100), nullable=True),
        sa.Column("veteran_status", sa.String(length=100), nullable=True),
        sa.Column("disability_status", sa.String(length=100), nullable=True),
        sa.Column("expected_salary", sa.String(length=50), nullable=True),
        sa.Column("current_salary", sa.String(length=50), nullable=True),
        sa.Column("salary_currency", sa.String(length=10), nullable=True),
        sa.Column("custom_fields", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_id", "users", ["id"], unique=False)
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_google_id", "users", ["google_id"], unique=True)
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "resumes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("file_key", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("parsed_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_resumes_id", "resumes", ["id"], unique=False)
    op.create_index("ix_resumes_session_id", "resumes", ["session_id"], unique=False)
    op.create_index("ix_resumes_user_id", "resumes", ["user_id"], unique=False)
    op.create_index("ix_resumes_file_key", "resumes", ["file_key"], unique=True)
    op.create_index("ix_resumes_session_id_id", "resumes", ["session_id", "id"], unique=False)

    op.create_table(
        "jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_jobs_id", "jobs", ["id"], unique=False)
    op.create_index("ix_jobs_session_id", "jobs", ["session_id"], unique=False)
    op.create_index("ix_jobs_user_id", "jobs", ["user_id"], unique=False)
    op.create_index("ix_jobs_session_id_id", "jobs", ["session_id", "id"], unique=False)

    op.create_table(
        "applications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("job_id", sa.Integer(), nullable=True),
        sa.Column("resume_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("company_name", sa.String(length=255), nullable=True),
        sa.Column("role_title", sa.String(length=255), nullable=True),
        sa.Column("portal_url", sa.Text(), nullable=True),
        sa.Column("job_board", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_applications_id", "applications", ["id"], unique=False)
    op.create_index("ix_applications_session_id", "applications", ["session_id"], unique=False)
    op.create_index("ix_applications_user_id", "applications", ["user_id"], unique=False)
    op.create_index("ix_applications_job_id", "applications", ["job_id"], unique=False)
    op.create_index("ix_applications_resume_id", "applications", ["resume_id"], unique=False)
    op.create_index(
        "ix_applications_session_id_id",
        "applications",
        ["session_id", "id"],
        unique=False,
    )

    op.create_table(
        "application_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("application_id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_application_events_id", "application_events", ["id"], unique=False)
    op.create_index(
        "ix_application_events_application_id",
        "application_events",
        ["application_id"],
        unique=False,
    )
    op.create_index(
        "ix_application_events_session_id",
        "application_events",
        ["session_id"],
        unique=False,
    )

    op.create_table(
        "pipeline_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("job_description", sa.Text(), nullable=True),
        sa.Column("resume_text", sa.Text(), nullable=True),
        sa.Column("resume_id", sa.Integer(), nullable=True),
        sa.Column("tailor_instructions", sa.Text(), nullable=True),
        sa.Column("cover_letter_instructions", sa.Text(), nullable=True),
        sa.Column("tailored_resume", sa.Text(), nullable=True),
        sa.Column("tailored_sections", sa.Text(), nullable=True),
        sa.Column("cover_letter", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["resume_id"], ["resumes.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pipeline_runs_id", "pipeline_runs", ["id"], unique=False)
    op.create_index("ix_pipeline_runs_session_id", "pipeline_runs", ["session_id"], unique=False)
    op.create_index("ix_pipeline_runs_user_id", "pipeline_runs", ["user_id"], unique=False)
    op.create_index("ix_pipeline_runs_resume_id", "pipeline_runs", ["resume_id"], unique=False)
    op.create_index(
        "ix_pipeline_runs_session_id_id",
        "pipeline_runs",
        ["session_id", "id"],
        unique=False,
    )

    op.create_table(
        "resume_drafts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("run_id", sa.Integer(), nullable=True),
        sa.Column("base_resume_id", sa.Integer(), nullable=False),
        sa.Column("starting_source", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("job_description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["base_resume_id"], ["resumes.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["pipeline_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_resume_drafts_id", "resume_drafts", ["id"], unique=False)
    op.create_index("ix_resume_drafts_session_id", "resume_drafts", ["session_id"], unique=False)
    op.create_index("ix_resume_drafts_run_id", "resume_drafts", ["run_id"], unique=False)
    op.create_index(
        "ix_resume_drafts_session_id_id",
        "resume_drafts",
        ["session_id", "id"],
        unique=False,
    )

    op.create_table(
        "resume_draft_sections",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("draft_id", sa.Integer(), nullable=False),
        sa.Column("section_id", sa.String(length=100), nullable=False),
        sa.Column("section_title", sa.String(length=255), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("original_text", sa.Text(), nullable=False),
        sa.Column("current_text", sa.Text(), nullable=False),
        sa.Column("proposed_text", sa.Text(), nullable=True),
        sa.Column("last_feedback", sa.String(length=20), nullable=True),
        sa.Column("editable", sa.Boolean(), nullable=False),
        sa.Column("para_start", sa.Integer(), nullable=True),
        sa.Column("para_end", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["draft_id"], ["resume_drafts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_resume_draft_sections_id", "resume_draft_sections", ["id"], unique=False)
    op.create_index("ix_resume_draft_sections_draft_id", "resume_draft_sections", ["draft_id"], unique=False)
    op.create_index(
        "ix_draft_sections_draft_id_order",
        "resume_draft_sections",
        ["draft_id", "order_index"],
        unique=False,
    )

    op.create_table(
        "section_chat_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("draft_id", sa.Integer(), nullable=False),
        sa.Column("section_id", sa.String(length=100), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("turn_index", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["draft_id"], ["resume_drafts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_section_chat_messages_id", "section_chat_messages", ["id"], unique=False)
    op.create_index(
        "ix_section_chat_messages_draft_id",
        "section_chat_messages",
        ["draft_id"],
        unique=False,
    )
    op.create_index(
        "ix_section_chat_draft_section",
        "section_chat_messages",
        ["draft_id", "section_id", "turn_index"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("section_chat_messages")
    op.drop_table("resume_draft_sections")
    op.drop_table("resume_drafts")
    op.drop_table("pipeline_runs")
    op.drop_table("application_events")
    op.drop_table("applications")
    op.drop_table("jobs")
    op.drop_table("resumes")
    op.drop_table("users")
