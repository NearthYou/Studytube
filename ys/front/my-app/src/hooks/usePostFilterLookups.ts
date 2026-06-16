import { useEffect, useMemo, useState } from 'react'
import { localizeLookupOptions } from '../utils/i18n'
import type { Language } from '../utils/language'
import { fetchPostFilters, type PostFilterLookups } from '../utils/lookupsApi'

const EMPTY_LOOKUPS: PostFilterLookups = {
  regions: [],
  themes: [],
  budgetRanges: [],
  seasons: [],
  companions: [],
}

export function usePostFilterLookups(language: Language, fallbackErrorMessage: string) {
  const [lookups, setLookups] = useState<PostFilterLookups>(EMPTY_LOOKUPS)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadLookups = async () => {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const data = await fetchPostFilters()

        if (isMounted) {
          setLookups(data)
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : fallbackErrorMessage)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadLookups()

    return () => {
      isMounted = false
    }
  }, [fallbackErrorMessage])

  const localizedLookups = useMemo<PostFilterLookups>(
    () => ({
      regions: localizeLookupOptions('region', lookups.regions, language),
      themes: localizeLookupOptions('theme', lookups.themes, language),
      budgetRanges: localizeLookupOptions('budget', lookups.budgetRanges, language),
      seasons: localizeLookupOptions('season', lookups.seasons, language),
      companions: localizeLookupOptions('companion', lookups.companions, language),
    }),
    [language, lookups],
  )

  return {
    errorMessage,
    isLoading,
    localizedLookups,
  }
}
