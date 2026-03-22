"""add application rich fields and status check constraint

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-21

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.exc import OperationalError


revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None

_RICH_COLUMNS = [
    ("job_description", sa.Text(), True),
    ("salary", sa.String(100), True),
    ("resume_filename", sa.String(255), True),
    ("resume_source", sa.String(100), True),
    ("cover_letter", sa.Text(), True),
]

ALLOWED_STATUSES = (
    "applied",
    "assessment",
    "interview_round_1",
    "interview_round_2",
    "interview_round_3",
    "offer",
    "rejected",
    "withdrawn",
)


def upgrade() -> None:
    for col_name, col_type, nullable in _RICH_COLUMNS:
        try:
            op.add_column(
                "applications",
                sa.Column(col_name, col_type, nullable=nullable),
            )
        except OperationalError:
            pass

    status_values = ", ".join(f"'{s}'" for s in ALLOWED_STATUSES)
    with op.batch_alter_table("applications") as batch_op:
        batch_op.create_check_constraint(
            "ck_applications_status",
            f"status IN ({status_values})",
        )


def downgrade() -> None:
    with op.batch_alter_table("applications") as batch_op:
        batch_op.drop_constraint("ck_applications_status", type_="check")

    for col_name, _, _ in reversed(_RICH_COLUMNS):
        try:
            op.drop_column("applications", col_name)
        except OperationalError:
            pass
