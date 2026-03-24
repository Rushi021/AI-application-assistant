"""add user access flags and web login code table

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-24

"""
from alembic import op
import sqlalchemy as sa


revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch_op.add_column(sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()))

    op.create_table(
        "web_login_codes",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("code_hash", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_web_login_codes_code_hash", "web_login_codes", ["code_hash"], unique=True)
    op.create_index("ix_web_login_codes_user_id", "web_login_codes", ["user_id"], unique=False)
    op.create_index("ix_web_login_codes_expires_at", "web_login_codes", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_web_login_codes_expires_at", table_name="web_login_codes")
    op.drop_index("ix_web_login_codes_user_id", table_name="web_login_codes")
    op.drop_index("ix_web_login_codes_code_hash", table_name="web_login_codes")
    op.drop_table("web_login_codes")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("is_admin")
        batch_op.drop_column("is_active")
