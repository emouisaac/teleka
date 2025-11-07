// Places handling logic
(function() {
    const originalHandleSelection = PlacesAutocomplete.handleSelection;
    
    PlacesAutocomplete.handleSelection = async function(input, item, onComplete) {
        if (!item || item._error) return;
        
        if (item.place_id && !String(item.place_id).startsWith('osm:')) {
            try {
                const resp = await fetch(`/api/places/details?place_id=${encodeURIComponent(item.place_id)}`);
                const data = await resp.json();
                
                if (data.result) {
                    const details = this.formatPlaceDetails(data.result);
                    input.value = details.displayName; // Use the full display name
                    if (typeof onComplete === 'function') onComplete();
                    return;
                }
            } catch (err) {
                console.warn('Error fetching place details:', err);
            }
        }
        
        // Fallback to original behavior
        const details = this.formatPlaceDetails(item);
        input.value = details.displayName;
        if (typeof onComplete === 'function') onComplete();
    };
})();