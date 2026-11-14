// True in the hosted build (staging and production). Wording that names "this
// computer" or a "local" workspace belongs to the local app only.
export const HOSTED = process.env.NEXT_PUBLIC_JOMCALL_MODE === "hosted";
