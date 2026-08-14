from app.modules.jobs.models import JobRequirement
from app.modules.matching.exact import match_exact, normalize


def _req(text: str, kind: str = "must_have") -> JobRequirement:
    return JobRequirement(job_id=1, text=text, kind=kind, category="skill", weight=1.0)


def test_python_exact_hit():
    result = match_exact([_req("Python")], ["Built Python APIs for data pipelines"])
    assert len(result.hits) == 1
    assert result.unmatched == []


def test_k8s_alias_matches_kubernetes():
    result = match_exact([_req("k8s")], ["Deployed Kubernetes clusters"])
    assert len(result.hits) == 1


def test_r_does_not_match_react():
    result = match_exact([_req("R")], ["Worked with React and Node.js"])
    assert result.hits == []
    assert len(result.unmatched) == 1


def test_word_boundary_js_not_inside_json():
    # "js" aliases to javascript, which should not hit a resume that only says JSON.
    result = match_exact([_req("javascript")], ["Parsed JSON payloads"])
    assert result.hits == []


def test_normalize_collapses_punctuation():
    assert "scikit-learn" in normalize("sklearn") or "scikit" in normalize("sklearn")
