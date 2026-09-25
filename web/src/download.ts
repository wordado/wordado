/**
 * Hands the browser a file to save, as a download link would. The object
 * URL outlives the click by a minute: Safari starts the download after the
 * click returns, and revoking at once can cancel it.
 */
export function saveFile(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
