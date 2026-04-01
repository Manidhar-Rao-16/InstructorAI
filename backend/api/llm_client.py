from autogen_ext.models.openai import OpenAIChatCompletionClient
from config import settings
import logging

logger = logging.getLogger("instructor_ai")


class LLMClientFactory:
    """Centralized LLM Client Factory for InstructorAI"""

    @staticmethod
    def create_client(
        model: str,
        temperature: float = 0.0,
        max_tokens: int = 32768,
        timeout: int = 300,
    ) -> OpenAIChatCompletionClient:
        
        api_key = settings.openrouter_api_key or settings.llm_api_key
        base_url = settings.openrouter_base_url or "https://openrouter.ai/api/v1"

        if not api_key:
            logger.error("❌ Missing API key for LLM client")

        return OpenAIChatCompletionClient(
            model=model,
            api_key=api_key,
            base_url=base_url,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
            model_info={
                "vision": False,
                "function_calling": True,
                "json_output": True,
                "family": "openrouter",
            },
            extra_kwargs={
                "extra_headers": {
                    "HTTP-Referer": "https://instructorai.com",
                    "X-Title": "InstructorAI",
                }
            }
        )