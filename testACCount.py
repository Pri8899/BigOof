import urllib.request, json

handle = 'ImposterBhO0'
solved_problems = set()
from_second = 0
pages_fetched = 0

print(f"Fetching AtCoder AC count for {handle}...")
while pages_fetched < 10:
    url = f'https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user={handle}&from_second={from_second}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            if not isinstance(data, list) or len(data) == 0:
                break
            for s in data:
                if s.get('result') == 'AC':
                    solved_problems.add(s.get('problem_id'))
            if len(data) < 500:
                break
            max_epoch = max(s.get('epoch_second', 0) for s in data)
            from_second = max_epoch + 1
            pages_fetched += 1
    except Exception as e:
        print('Error:', e)
        break

print(f"Total unique solved problems: {len(solved_problems)}")
