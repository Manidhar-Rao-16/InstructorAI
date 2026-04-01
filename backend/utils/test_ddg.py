from duckduckgo_search import DDGS

with DDGS() as ddgs:
    results = ddgs.videos("react hooks tutorial", max_results=1)
    print(results)
    
    docs = ddgs.text("react hooks documentation", max_results=1)
    print(docs)
