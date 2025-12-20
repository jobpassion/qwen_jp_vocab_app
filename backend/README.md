# Backend quick notes

- Auth: use `/auth/login` to obtain `token` (sessions unchanged). Send it via `Authorization: Bearer <token>` for `/scores`.
- Upload multiple pages: POST `/scores` with `multipart/form-data`, field `images` can repeat; optional `pages` JSON array (per-file metadata like `{ "order": 0, "width": 1200, "height": 1800 }`), `coverIndex` to pick cover (defaults first). `config` accepts JSON/string; uploaded pages overwrite/replace existing ones by default.
- Update pages: PUT `/scores/:id` accepts the same fields. If you want to append pages instead of replacing, set `appendPages=true`.
- Responses now include `pages` with `filename` and `imageUrl` for every uploaded page; `config` echoes stored config JSON.
- Static access: uploaded files served from `config.scoreUploadRoute` (default `/uploads/scores`), also used in `pages[*].imageUrl` and `imageUrl`.
- Share links: POST `/scores/:id/share` (auth) to generate a token + `sharePath`/`shareUrl` (optional body `expiresInHours`), GET `/scores/share/:token` without auth to read the shared score (JSON only), DELETE `/scores/:id/share` to revoke. `sharePath` points to `/share/:token` (HTML 页面) so你可以直接发送给别人查看；`shareApiPath`/`shareApiUrl` 是 JSON 接口。设置 `SHARE_BASE_URL` 可生成完整链接。
- Sync push now also accepts乐谱：`POST /sync` 的 payload 里可带 `scores` 字段（数组）。每首包含 `title`、可选 `composer/description/config/coverIndex`，`pages` 必填且需带 base64 图片：
  ```json
  {
    "format": "jp_vocab_app_backup",
    "version": 1,
    "exportedAt": "2024-12-01T12:00:00Z",
    "pages": [],
    "apiConfig": {},
    "examHistory": {},
    "pdf": null,
    "scores": [
      {
        "id": 12,
        "title": "Moonlight",
        "composer": "Beethoven",
        "coverIndex": 0,
        "config": { "scroll": 1.2 },
        "pages": [
          {
            "order": 0,
            "width": 1200,
            "height": 1800,
            "image": { "encoding": "base64", "mimeType": "image/jpeg", "data": "<BASE64>" }
          }
        ]
      }
    ]
  }
  ```
  - 如果携带 `scores`，后端会用传入的整份列表替换该用户的乐谱记录：存在的 `id` 更新，缺少的会删除，其余会新增；图片会写入 `SCORE_UPLOAD_DIR`，旧文件自动清理。只发送 `scores` 时（可以为空数组表示清空），无需走 `/scores` 的 multipart 上传。

Example upload (replace URLs/ports as needed):
```
curl -X POST http://localhost:8000/scores \
  -H "Authorization: Bearer <token>" \
  -F 'title=Test score' \
  -F 'config={"scroll":1.5}' \
  -F 'pages=[{"order":0},{"order":1}]' \
  -F "images=@/path/to/page1.jpg" \
  -F "images=@/path/to/page2.jpg"
```
