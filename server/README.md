# Сервер рекордов (топ игроков)

`score.mjs` — один файл на Node 18+, без зависимостей. Хранит таблицу в `data/scores.json`, секрет для подписи жетонов — в `data/secret` (создаётся сам).
Слушает только `127.0.0.1:8787`, наружу его отдаёт Caddy по адресу `https://myzombika.pion.ltd/api/...`.

## Установка на сервер (Hetzner, 178.105.120.9)

```bash
# 1. Node (если ещё нет)
node -v || (curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs)

# 2. Файл сервиса
mkdir -p /opt/myzombika-score
# скопировать server/score.mjs сюда, например с ПК:
#   scp server/score.mjs root@178.105.120.9:/opt/myzombika-score/
useradd --system --home /opt/myzombika-score --shell /usr/sbin/nologin myzombika 2>/dev/null || true
mkdir -p /opt/myzombika-score/data && chown -R myzombika: /opt/myzombika-score

# 3. systemd
cp myzombika-score.service /etc/systemd/system/   # файл лежит рядом
systemctl daemon-reload
systemctl enable --now myzombika-score
systemctl status myzombika-score --no-pager
curl -s 127.0.0.1:8787/api/top      # → {"top":[],"total":0}
```

## Caddy

В блок сайта `myzombika.pion.ltd` добавить строку с `/api/*` **перед** раздачей файлов:

```caddy
myzombika.pion.ltd {
	handle /api/* {
		reverse_proxy 127.0.0.1:8787
	}
	handle {
		# то, что уже было: root * ... / file_server
	}
}
```

Если в блоке сейчас просто `root` + `file_server` без `handle`, достаточно добавить `reverse_proxy /api/* 127.0.0.1:8787` — Caddy сам ставит reverse_proxy раньше file_server.

Потом `caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`, и проверить снаружи:
`curl -s https://myzombika.pion.ltd/api/top`.

## Обновление

Скопировать новый `score.mjs` в `/opt/myzombika-score/` и `systemctl restart myzombika-score`. Таблица в `data/` сохраняется.

## Что проверяет сервер

- Результат принимается только с жетоном забега, который сервер выдал при старте игры (`/api/start`), один раз на жетон; время игры не больше, чем прошло с выдачи жетона.
- Очки, убийства, волна и время должны сходиться: 5..100 очков за убийство, не больше 4 убийств в секунду, волна не быстрее 6 секунд, убийств не больше, чем монстров вышло за эти волны.
- Не чаще раза в 10 секунд и 60 раз в час с одного адреса.
- Имя до 16 символов, без `<>&"` и управляющих символов. В таблице лучший результат каждого имени, хранится 1000 лучших.

Отклонённые результаты пишутся в журнал: `journalctl -u myzombika-score`.
