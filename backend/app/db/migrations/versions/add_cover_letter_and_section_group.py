"""add cover_letter and section_group

Revision ID: a1b2c3d4e5f6
Revises: d0e1f2a3b4c5
Create Date: 2025-02-08

"""
from alembic import op
import sqlalchemy as sa


revision = "a1b2c3d4e5f6"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("resume_drafts", sa.Column("cover_letter", sa.Text(), nullable=True))
    op.add_column("resume_draft_sections", sa.Column("section_group", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("resume_draft_sections", "section_group")
    op.drop_column("resume_drafts", "cover_letter")
