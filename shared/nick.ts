// Friendly display nicknames. They come from the wallet address, so the same address always gets the same name.
// Display only: nothing here ever decides who wins or who gets paid.
const ADJ = ['Zippy', 'Sunny', 'Cosy', 'Brave', 'Jolly', 'Swift', 'Lucky', 'Mellow', 'Peppy', 'Snappy', 'Breezy', 'Dapper', 'Fuzzy', 'Gentle', 'Happy', 'Nimble', 'Plucky', 'Quirky', 'Spicy', 'Witty', 'Cheery', 'Bouncy', 'Chill', 'Daring']
const ANI = ['Otter', 'Falcon', 'Koala', 'Panda', 'Gecko', 'Lynx', 'Heron', 'Badger', 'Fox', 'Newt', 'Moose', 'Parrot', 'Quokka', 'Raven', 'Tiger', 'Walrus', 'Yak', 'Zebra', 'Bison', 'Crane', 'Dingo', 'Ferret', 'Llama', 'Mole']
export function nickOf(address: string): string {
  const s = address.replace(/\s/g, '').toUpperCase()
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return `${ADJ[h % ADJ.length]} ${ANI[(h >>> 8) % ANI.length]}`.slice(0, 16)
}
export const isLegacyName = (n: string) => /^Player [0-9A-Z]{4}$/.test(n)
