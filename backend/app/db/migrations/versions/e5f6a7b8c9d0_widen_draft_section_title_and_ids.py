"""widen resume_draft_sections title and section_id; chat section_id

Revision ID: e5f6a7b8c9d0
Revises: c3d4e5f6a7b8
Create Date: 2026-03-24

Long resume section titles (first line + metadata) exceed VARCHAR(255) after tailoring.
"""

from alembic import op
import sqlalchemy as sa


revision = "e5f6a7b8c9d0"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.alter_column(
            "resume_draft_sections",
            "section_title",
            existing_type=sa.String(255),
            type_=sa.Text(),
            existing_nullable=False,
        )
        op.alter_column(
            "resume_draft_sections",
            "section_id",
            existing_type=sa.String(100),
            type_=sa.String(512),
            existing_nullable=False,
        )
        op.alter_column(
            "section_chat_messages",
            "section_id",
            existing_type=sa.String(100),
            type_=sa.String(512),
            existing_nullable=False,
        )
    else:
        with op.batch_alter_table("resume_draft_sections") as batch_op:
            batch_op.alter_column(
                "section_title",
                existing_type=sa.String(255),
                type_=sa.Text(),
                existing_nullable=False,
            )
            batch_op.alter_column(
                "section_id",
                existing_type=sa.String(100),
                type_=sa.String(512),
                existing_nullable=False,
            )
        with op.batch_alter_table("section_chat_messages") as batch_op:
            batch_op.alter_column(
                "section_id",
                existing_type=sa.String(100),
                type_=sa.String(512),
                existing_nullable=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.alter_column(
            "resume_draft_sections",
            "section_title",
            existing_type=sa.Text(),
            type_=sa.String(255),
            existing_nullable=False,
            postgresql_using="left(section_title::text, 255)",
        )
        op.alter_column(
            "resume_draft_sections",
            "section_id",
            existing_type=sa.String(512),
            type_=sa.String(100),
            existing_nullable=False,
            postgresql_using="left(section_id::text, 100)",
        )
        op.alter_column(
            "section_chat_messages",
            "section_id",
            existing_type=sa.String(512),
            type_=sa.String(100),
            existing_nullable=False,
            postgresql_using="left(section_id::text, 100)",
        )
    else:
        with op.batch_alter_table("resume_draft_sections") as batch_op:
            batch_op.alter_column(
                "section_title",
                existing_type=sa.Text(),
                type_=sa.String(255),
                existing_nullable=False,
            )
            batch_op.alter_column(
                "section_id",
                existing_type=sa.String(512),
                type_=sa.String(100),
                existing_nullable=False,
            )
        with op.batch_alter_table("section_chat_messages") as batch_op:
            batch_op.alter_column(
                "section_id",
                existing_type=sa.String(512),
                type_=sa.String(100),
                existing_nullable=False,
            )
