export const MODEL_CHOICES = [
  {
    id: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    name: "Llama 3.2 1B",
    family: "Llama",
    memoryMB: 1129,
    purpose: "General assistance",
    half: false,
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
    name: "Llama 3.2 3B",
    family: "Llama",
    memoryMB: 2952,
    purpose: "General assistance",
    half: false,
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 1B / FP16",
    family: "Llama",
    memoryMB: 879,
    purpose: "Lower memory",
    half: true,
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 3B / FP16",
    family: "Llama",
    memoryMB: 2264,
    purpose: "Lower memory",
    half: true,
  },
  {
    id: "Qwen2.5-Coder-0.5B-Instruct-q4f32_1-MLC",
    name: "Qwen2.5-Coder 0.5B",
    family: "Qwen",
    memoryMB: 1060,
    purpose: "Small coding tasks",
    half: false,
  },
  {
    id: "Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC",
    name: "Qwen2.5-Coder 1.5B",
    family: "Qwen",
    memoryMB: 1889,
    purpose: "Code generation",
    half: false,
  },
  {
    id: "Qwen2.5-Coder-3B-Instruct-q4f32_1-MLC",
    name: "Qwen2.5-Coder 3B",
    family: "Qwen",
    memoryMB: 2894,
    purpose: "Code generation",
    half: false,
  },
  {
    id: "Qwen2.5-Coder-7B-Instruct-q4f32_1-MLC",
    name: "Qwen2.5-Coder 7B",
    family: "Qwen",
    memoryMB: 5901,
    purpose: "Larger desktop GPUs",
    half: false,
  },
  {
    id: "SmolLM2-360M-Instruct-q4f32_1-MLC",
    name: "SmolLM2 360M",
    family: "SmolLM",
    memoryMB: 580,
    purpose: "Smallest download",
    half: false,
  },
  {
    id: "SmolLM2-1.7B-Instruct-q4f32_1-MLC",
    name: "SmolLM2 1.7B",
    family: "SmolLM",
    memoryMB: 2693,
    purpose: "General assistance",
    half: false,
  },
] as const;

export const DEFAULT_MODEL_ID = MODEL_CHOICES[0].id;

export function modelChoice(id: string) {
  const choice = MODEL_CHOICES.find((model) => model.id === id);
  if (!choice) throw new Error("Choose a supported browser model.");
  return choice;
}

export function modelSource(id: string) {
  modelChoice(id);
  return `https://modelscope.cn/models/mlc-ai/${id}`;
}
