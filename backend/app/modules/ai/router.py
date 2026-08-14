from fastapi import APIRouter, Depends

from app.core.deps import get_current_user, get_model_gateway
from app.modules.ai.gateway import ModelGateway
from app.modules.ai.schemas import ModelsDiagnostics

router = APIRouter(prefix="/models", tags=["models"])


@router.get("", response_model=ModelsDiagnostics)
def list_models(
    current_user=Depends(get_current_user),
    gateway: ModelGateway = Depends(get_model_gateway),
) -> ModelsDiagnostics:
    """Registered providers plus the resolved per-task routing. Confirms a swap took effect."""
    payload = gateway.diagnostics()
    return ModelsDiagnostics.model_validate(payload)
