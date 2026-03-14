import {
  testRadioGroupsByNames,
  testCheckboxesByDescriptors,
  testDropdownsByDescriptors,
  scanPhase1Candidates,
  runPhase1Fill,
  runUnifiedAutofill,
  matchPhase1Field,
  fillPhase1Field,
  verifyPhase1Write,
  classifyPhase1SkipReason,
  scanUploadDetectors,
} from "@/shared/dom-control-engine";

type DomRuntimeApi = {
  testRadioGroupsByNames: typeof testRadioGroupsByNames;
  testCheckboxesByDescriptors: typeof testCheckboxesByDescriptors;
  testDropdownsByDescriptors: typeof testDropdownsByDescriptors;
  scanPhase1Candidates: typeof scanPhase1Candidates;
  matchPhase1Field: typeof matchPhase1Field;
  fillPhase1Field: typeof fillPhase1Field;
  verifyPhase1Write: typeof verifyPhase1Write;
  classifyPhase1SkipReason: typeof classifyPhase1SkipReason;
  runPhase1Fill: typeof runPhase1Fill;
  runUnifiedAutofill: typeof runUnifiedAutofill;
  scanUploadDetectors: typeof scanUploadDetectors;
};

declare global {
  interface Window {
    __AI_DOM_CONTROL_ENGINE__?: DomRuntimeApi;
  }
}

window.__AI_DOM_CONTROL_ENGINE__ = {
  testRadioGroupsByNames,
  testCheckboxesByDescriptors,
  testDropdownsByDescriptors,
  scanPhase1Candidates,
  matchPhase1Field,
  fillPhase1Field,
  verifyPhase1Write,
  classifyPhase1SkipReason,
  runPhase1Fill,
  runUnifiedAutofill,
  scanUploadDetectors,
};
