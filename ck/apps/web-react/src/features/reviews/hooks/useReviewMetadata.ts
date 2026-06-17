import { useEffect, useMemo, useState } from "react"
import { getPerformances, getTheaters } from "../api"
import type { PerformanceOption, ReviewWorkOption, TheaterOption } from "../types"

function getDisplayTitle(performance: PerformanceOption) {
  return (
    performance.displayTitle ??
    [performance.seasonLabel, performance.musicalTitle].filter(Boolean).join(" ")
  )
}

export function useReviewMetadata(selectedTheaterId: string) {
  const [theaters, setTheaters] = useState<TheaterOption[]>([])
  const [performances, setPerformances] = useState<PerformanceOption[]>([])

  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true)
  const [isLoadingPerformances, setIsLoadingPerformances] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    async function loadMetadata() {
      try {
        setError("")
        setIsLoadingMetadata(true)

        const theaterData = await getTheaters()

        setTheaters(theaterData)
      } catch (err) {
        setError(err instanceof Error ? err.message : "메타데이터를 불러오지 못했습니다.")
      } finally {
        setIsLoadingMetadata(false)
      }
    }

    void loadMetadata()
  }, [])

  useEffect(() => {
    if (!selectedTheaterId) {
      return
    }

    let isMounted = true

    async function loadPerformances() {
      try {
        setError("")
        setIsLoadingPerformances(true)
        setPerformances([])

        const performanceData = await getPerformances({
          theaterId: selectedTheaterId,
        })

        if (isMounted) {
          setPerformances(performanceData)
        }
      } catch (err) {
        if (isMounted) {
          setPerformances([])
          setError(err instanceof Error ? err.message : "공연 목록을 불러오지 못했습니다.")
        }
      } finally {
        if (isMounted) {
          setIsLoadingPerformances(false)
        }
      }
    }

    void loadPerformances()

    return () => {
      isMounted = false
    }
  }, [selectedTheaterId])

  const workOptions = useMemo<ReviewWorkOption[]>(() => {
    const currentPerformances = selectedTheaterId ? performances : []

    return currentPerformances.map((performance) => {
      const displayTitle = getDisplayTitle(performance)

      return {
        performanceId: performance.id,
        musicalId: performance.musicalId,
        musicalTitle: performance.musicalTitle,
        seasonLabel: performance.seasonLabel,
        displayTitle,
        searchText: `${performance.musicalTitle} ${displayTitle}`.toLowerCase(),
      }
    })
  }, [performances, selectedTheaterId])

  return {
    theaters,
    workOptions,
    performances: selectedTheaterId ? performances : [],
    isLoadingMetadata,
    isLoadingPerformances: selectedTheaterId ? isLoadingPerformances : false,
    error,
  }
}
